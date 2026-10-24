import { Uri } from "vscode";

/** Usage with no folder open (Cursor `empty-window` / no workspaceFolders). */
export const NO_WORKSPACE_ID = "no-workspace";
export const NO_WORKSPACE_LABEL = "No workspace";

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
