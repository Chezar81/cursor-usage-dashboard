import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  NO_WORKSPACE_ID,
  NO_WORKSPACE_LABEL,
  WORKSPACE_RENAMES,
  canonicalDisplayName,
  normalizeWorkspaceId,
} from "./workspaceLabels";

export interface ConversationWorkspace {
  workspaceId: string;
  displayName: string;
}

const CURSOR_PROJECT_PREFIX = "cursor-project:";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map Cursor usage `conversationId` → local workspace via agent transcripts
 * under `~/.cursor/projects/<slug>/agent-transcripts/<conversationId>/`.
 */
export function buildConversationWorkspaceMap(): Map<string, ConversationWorkspace> {
  const map = new Map<string, ConversationWorkspace>();
  const projectsRoot = path.join(os.homedir(), ".cursor", "projects");
  if (!fs.existsSync(projectsRoot)) {
    return map;
  }

  let projectDirs: string[] = [];
  try {
    projectDirs = fs.readdirSync(projectsRoot);
  } catch {
    return map;
  }

  for (const slug of projectDirs) {
    if (slug.startsWith(".")) {
      continue;
    }
    const transcriptsDir = path.join(projectsRoot, slug, "agent-transcripts");
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(transcriptsDir);
    } catch {
      continue;
    }

    const identity = identityFromProjectSlug(slug);
    for (const name of entries) {
      if (!UUID_RE.test(name)) {
        continue;
      }
      const full = path.join(transcriptsDir, name);
      try {
        if (!fs.statSync(full).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      // First project that owns the transcript wins (IDs are unique).
      if (!map.has(name)) {
        map.set(name, identity);
      }
    }
  }

  return map;
}

export function identityFromProjectSlug(slug: string): ConversationWorkspace {
  if (slug === "empty-window") {
    return { workspaceId: NO_WORKSPACE_ID, displayName: NO_WORKSPACE_LABEL };
  }
  if (/^\d{10,16}$/.test(slug) || slug.startsWith("tmp-") || slug === "ext-dev") {
    return {
      workspaceId: `${CURSOR_PROJECT_PREFIX}${slug}`,
      displayName: slug.startsWith("tmp-") ? "Temporary" : slug,
    };
  }

  const workspacesIdx = slug.lastIndexOf("Workspaces-");
  if (workspacesIdx >= 0) {
    const rest = slug.slice(workspacesIdx + "Workspaces-".length);
    const displayName = rest || slug;
    // Prefer a real folder under ~/Dokumente/Cursor Workspaces when possible.
    const resolved = resolveWorkspacesFolder(displayName);
    if (resolved) {
      return resolved;
    }
    return {
      workspaceId: `${CURSOR_PROJECT_PREFIX}${slug}`,
      displayName,
    };
  }

  return {
    workspaceId: `${CURSOR_PROJECT_PREFIX}${slug}`,
    displayName: slug,
  };
}

/**
 * Collapse alias ids (cursor-project slugs, alternate Cursor Workspaces
 * paths, legacy no-folder) onto one stable identity per project.
 */
export function canonicalizeWorkspaceIdentity(match: {
  workspaceId: string;
  displayName: string;
}): ConversationWorkspace {
  if (
    match.workspaceId === "no-folder" ||
    match.workspaceId === NO_WORKSPACE_ID ||
    match.displayName === "(no folder)" ||
    match.displayName === NO_WORKSPACE_LABEL
  ) {
    return { workspaceId: NO_WORKSPACE_ID, displayName: NO_WORKSPACE_LABEL };
  }

  const workspaceId = normalizeWorkspaceId(match.workspaceId);

  if (workspaceId.startsWith(CURSOR_PROJECT_PREFIX)) {
    return identityFromProjectSlug(
      workspaceId.slice(CURSOR_PROJECT_PREFIX.length)
    );
  }

  if (workspaceId.startsWith("file:")) {
    const remapped = remapCursorWorkspacesFileUri(workspaceId);
    if (remapped) {
      return remapped;
    }
    const base = fileUriBasename(workspaceId);
    const displayName = canonicalDisplayName(
      match.displayName || base || workspaceId
    );
    return {
      workspaceId,
      displayName,
    };
  }

  const fromName =
    match.displayName && match.displayName !== workspaceId
      ? resolveWorkspacesFolder(match.displayName)
      : undefined;
  if (fromName) {
    return fromName;
  }

  // Display-name-only rows (or unresolved paths) still follow known renames.
  const renamedOnly = resolveWorkspacesFolder(
    canonicalDisplayName(match.displayName || workspaceId)
  );
  if (renamedOnly) {
    return renamedOnly;
  }

  return {
    workspaceId,
    displayName: canonicalDisplayName(match.displayName || workspaceId),
  };
}

export function isCursorProjectId(workspaceId: string): boolean {
  return workspaceId.startsWith(CURSOR_PROJECT_PREFIX);
}

function remapCursorWorkspacesFileUri(
  fileUri: string
): ConversationWorkspace | undefined {
  const fsPath = fileUriToFsPath(fileUri);
  if (!fsPath) {
    return undefined;
  }
  const parent = path.basename(path.dirname(fsPath));
  if (parent !== "Cursor Workspaces") {
    return undefined;
  }
  const base = path.basename(fsPath);
  if (!base) {
    return undefined;
  }
  // Always prefer the canonical folder under Dokumente/Documents when it exists,
  // so ~/Cursor Workspaces/Foo and ~/Dokumente/Cursor Workspaces/Foo collapse.
  return resolveWorkspacesFolder(base);
}

function resolveWorkspacesFolder(
  slugTail: string
): ConversationWorkspace | undefined {
  const roots = [
    path.join(os.homedir(), "Dokumente", "Cursor Workspaces"),
    path.join(os.homedir(), "Documents", "Cursor Workspaces"),
  ];
  // Prefer the post-rename folder name when the old basename no longer exists.
  const renameKey = slugTail.trim().toLowerCase().replace(/_/g, "-");
  const renamed = WORKSPACE_RENAMES[renameKey];
  const needles = renamed ? [renamed, slugTail] : [slugTail];

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    let names: string[] = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const candidate of needles) {
      const needle = candidate.toLowerCase().replace(/_/g, "-");
      for (const name of names) {
        if (name.endsWith(".code-workspace")) {
          continue;
        }
        const cand = name.toLowerCase().replace(/_/g, "-");
        if (cand !== needle) {
          continue;
        }
        const fsPath = path.join(root, name);
        try {
          if (!fs.statSync(fsPath).isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }
        return {
          workspaceId: normalizeWorkspaceId(pathToFileUri(fsPath)),
          displayName: name,
        };
      }
    }
  }
  return undefined;
}

function pathToFileUri(fsPath: string): string {
  return pathToFileURL(path.resolve(fsPath)).href;
}

function fileUriToFsPath(fileUri: string): string | undefined {
  try {
    return fileURLToPath(fileUri);
  } catch {
    return undefined;
  }
}

function fileUriBasename(fileUri: string): string | undefined {
  const fsPath = fileUriToFsPath(fileUri);
  return fsPath ? path.basename(fsPath) : undefined;
}
