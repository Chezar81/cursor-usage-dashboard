import * as vscode from "vscode";
import type { DashboardAppearance } from "./appearance";
import { getAppearance } from "./appearance";
import type { CurrencyPrefs, DisplayCurrency } from "./currency";
import { getCurrencyPrefs } from "./currency";
import type { DashboardData } from "./types";
import { getDashboardHtml } from "./webview/dashboardHtml";

export class DashboardPanel {
  public static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private latest: DashboardData | undefined;
  /** True after the webview has posted `ready` (safe to postMessage). */
  private webviewReady = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly onRefresh: () => void,
    private readonly onSetToken: () => void,
    private readonly onSetCurrency: (currency: DisplayCurrency) => void,
    private readonly onSetAppearance: (appearance: DashboardAppearance) => void,
    private readonly onDisposePanel: (() => void) | undefined,
    initial?: DashboardData
  ) {
    this.panel = panel;
    this.latest = initial;
    this.panel.webview.html = getDashboardHtml(this.panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === "refresh") {
          this.onRefresh();
        } else if (msg?.type === "ready") {
          this.webviewReady = true;
          if (this.latest) {
            this.post(this.latest);
          } else {
            this.postPrefsOnly();
          }
        } else if (msg?.type === "setToken") {
          this.onSetToken();
        } else if (msg?.type === "setCurrency") {
          const c = msg.currency === "EUR" ? "EUR" : "USD";
          this.onSetCurrency(c);
        } else if (msg?.type === "setAppearance") {
          const appearance =
            msg.appearance === "light" || msg.appearance === "dark"
              ? msg.appearance
              : "system";
          this.onSetAppearance(appearance);
        } else if (msg?.type === "viewContextReport") {
          void vscode.env.openExternal(
            vscode.Uri.parse("https://cursor.com/docs/agent/prompting")
          );
        }
      },
      null,
      this.disposables
    );
  }

  static show(
    extensionUri: vscode.Uri,
    onRefresh: () => void,
    onSetToken: () => void,
    onSetCurrency: (currency: DisplayCurrency) => void,
    onSetAppearance: (appearance: DashboardAppearance) => void,
    initial?: DashboardData,
    onDisposePanel?: () => void
  ): DashboardPanel {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (DashboardPanel.current) {
      // Do not reset webview.html — that races postMessage and leaves "Loading…".
      DashboardPanel.current.panel.reveal(column);
      if (initial) {
        DashboardPanel.current.update(initial);
      } else if (DashboardPanel.current.latest) {
        DashboardPanel.current.pushLatest();
      }
      return DashboardPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "cursorUsageDashboard",
      "Usage Dashboard",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      }
    );
    DashboardPanel.current = new DashboardPanel(
      panel,
      onRefresh,
      onSetToken,
      onSetCurrency,
      onSetAppearance,
      onDisposePanel,
      initial
    );
    return DashboardPanel.current;
  }

  /** True while the webview tab is the visible editor group content. */
  isVisible(): boolean {
    return this.panel.visible;
  }

  update(data: DashboardData): void {
    this.latest = data;
    this.pushLatest();
  }

  /**
   * Patch only the Context Usage box (local poll; no full dashboard re-render).
   */
  updateContextUsage(contextUsage: DashboardData["contextUsage"]): void {
    if (!this.latest) {
      return;
    }
    this.latest = { ...this.latest, contextUsage };
    if (!this.webviewReady) {
      return;
    }
    void this.panel.webview.postMessage({
      type: "contextUsage",
      payload: contextUsage,
    });
  }

  /** Re-push prefs (and latest data) after currency setting changes. */
  refreshPrefs(): void {
    if (this.latest) {
      this.pushLatest();
    } else if (this.webviewReady) {
      this.postPrefsOnly();
    }
  }

  private pushLatest(): void {
    if (!this.latest) {
      return;
    }
    if (this.webviewReady) {
      this.post(this.latest);
      return;
    }
    // Webview still loading — `ready` handler will flush `latest`.
  }

  private prefs(): CurrencyPrefs & { appearance: DashboardAppearance } {
    return { ...getCurrencyPrefs(), appearance: getAppearance() };
  }

  private post(data: DashboardData): void {
    void this.panel.webview.postMessage({
      type: "data",
      payload: data,
      prefs: this.prefs(),
    });
  }

  private postPrefsOnly(): void {
    void this.panel.webview.postMessage({
      type: "prefs",
      prefs: this.prefs(),
    });
  }

  dispose(): void {
    DashboardPanel.current = undefined;
    this.onDisposePanel?.();
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
