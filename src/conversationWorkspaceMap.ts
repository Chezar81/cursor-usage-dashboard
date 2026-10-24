import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  NO_WORKSPACE_ID,
  NO_WORKSPACE_LABEL,
  normalizeWorkspaceId,
} from "./workspaceLabels";

export interface ConversationWorkspace {
  workspaceId: string;
  displayName: string;
}

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
      workspaceId: `cursor-project:${slug}`,
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
      workspaceId: `cursor-project:${slug}`,
      displayName,
    };
  }

  return {
    workspaceId: `cursor-project:${slug}`,
    displayName: slug,
  };
}

function resolveWorkspacesFolder(
  slugTail: string
): ConversationWorkspace | undefined {
  const roots = [
    path.join(os.homedir(), "Dokumente", "Cursor Workspaces"),
    path.join(os.homedir(), "Documents", "Cursor Workspaces"),
  ];
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
    const needle = slugTail.toLowerCase().replace(/_/g, "-");
    for (const name of names) {
      const cand = name.toLowerCase().replace(/_/g, "-");
      if (cand === needle) {
        const fsPath = path.join(root, name);
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
