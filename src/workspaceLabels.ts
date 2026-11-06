import { Uri } from "vscode";

/** Usage with no folder open (Cursor `empty-window` / no workspaceFolders). */
export const NO_WORKSPACE_ID = "no-workspace";
export const NO_WORKSPACE_LABEL = "No workspace";

/**
 * Known folder renames under Cursor Workspaces.
 * Old display names / path basenames map to the current folder name so usage
 * from before the rename folds into one Workspaces row.
 */
export const WORKSPACE_RENAMES: Record<string, string> = {
  anonbrowser: "MintShield",
};

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

/** Underscore/hyphen-insensitive key; applies known renames for grouping. */
export function normalizeDisplayName(name: string): string {
  const key = name.trim().toLowerCase().replace(/_/g, "-");
  const renamed = WORKSPACE_RENAMES[key];
  return renamed ? renamed.trim().toLowerCase().replace(/_/g, "-") : key;
}

/** Current display name after applying known renames (preserves target casing). */
export function canonicalDisplayName(name: string): string {
  const key = name.trim().toLowerCase().replace(/_/g, "-");
  return WORKSPACE_RENAMES[key] ?? name;
}
