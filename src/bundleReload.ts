import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const SETTLE_MS = 700;

/**
 * Reload the window when this extension's bundle is replaced on disk.
 * A full window reload is what Cursor needs to run a newly installed
 * extension.js; the mtime check avoids reloading again on startup.
 */
export function watchBundleReload(context: vscode.ExtensionContext): void {
  const bundlePath = path.join(context.extensionPath, "dist", "extension.js");
  let seenMtimeMs = mtimeOf(bundlePath);
  if (seenMtimeMs === undefined) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      const next = mtimeOf(bundlePath);
      if (next === undefined || next <= seenMtimeMs!) {
        return;
      }
      seenMtimeMs = next;
      void vscode.commands.executeCommand("workbench.action.reloadWindow");
    }, SETTLE_MS);
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(path.dirname(bundlePath), schedule);
  } catch {
    return;
  }

  context.subscriptions.push({
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
      }
      watcher.close();
    },
  });
}

function mtimeOf(filePath: string): number | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 1000) {
      return undefined;
    }
    return stat.mtimeMs;
  } catch {
    return undefined;
  }
}
