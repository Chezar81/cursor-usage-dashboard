import * as vscode from "vscode";

/** System follows Cursor's active color theme. */
export type DashboardAppearance = "system" | "light" | "dark";

export function getAppearance(): DashboardAppearance {
  const raw = vscode.workspace
    .getConfiguration("cursorUsage")
    .get<string>("appearance", "system");
  return raw === "light" || raw === "dark" ? raw : "system";
}

export async function setAppearance(
  appearance: DashboardAppearance
): Promise<void> {
  await vscode.workspace
    .getConfiguration("cursorUsage")
    .update("appearance", appearance, vscode.ConfigurationTarget.Global);
}
