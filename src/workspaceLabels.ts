import { Uri } from "vscode";

/** Usage with no folder open (Cursor `empty-window` / no workspaceFolders). */
export const NO_WORKSPACE_ID = "no-workspace";
export const NO_WORKSPACE_LABEL = "No workspace";

/**
 * Optional old→current folder-name map from `cursorUsage.workspaceRenames`.
 * Kept empty in source so personal project names stay out of the public repo.
 */
let workspaceRenames: Record<string, string> = {};

/** Load rename aliases from settings (or clear when empty/undefined). */
export function configureWorkspaceRenames(
  map: Record<string, string> | undefined | null
): void {
  const next: Record<string, string> = {};
  if (map && typeof map === "object" && !Array.isArray(map)) {
    for (const [from, to] of Object.entries(map)) {
      if (typeof from !== "string" || typeof to !== "string") {
        continue;
      }
      const key = renameKey(from);
      const target = to.trim();
      if (!key || !target) {
        continue;
      }
      next[key] = target;
    }
  }
  workspaceRenames = next;
}

/** Underscore / hyphen / space-insensitive folder-name key. */
function renameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/** Look up a configured rename by underscore/hyphen-insensitive key. */
export function lookupWorkspaceRename(key: string): string | undefined {
  return workspaceRenames[key];
}

/** Stable file URI comparison across vscode / pathToFileURL encodings. */
export function normalizeWorkspaceId(id: string): string {
  if (!id.startsWith("file:")) {
    return id;
  }
  try {
    const u = Uri.parse(id);
    return u.with({ path: u.path.replace(/\/$/, "") || u.path }).toString();
  } catch {
    return id.replace(/\/$/, "");
  }
}

/**
 * Cursor multi-root `.code-workspace` windows append " (Workspace)" to the
 * window title. Strip that so they group with the primary folder row.
 */
export function stripWorkspaceWindowSuffix(name: string): string {
  return name.replace(/\s*\(Workspace\)\s*$/i, "").trim();
}

/** Underscore/hyphen-insensitive key; applies configured renames for grouping. */
export function normalizeDisplayName(name: string): string {
  const key = renameKey(stripWorkspaceWindowSuffix(name));
  const renamed = lookupWorkspaceRename(key);
  return renamed ? renameKey(renamed) : key;
}

/** Current display name after applying configured renames (preserves target casing). */
export function canonicalDisplayName(name: string): string {
  const stripped = stripWorkspaceWindowSuffix(name);
  return lookupWorkspaceRename(renameKey(stripped)) ?? stripped;
}
