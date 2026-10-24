import * as vscode from "vscode";
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
    initial?: DashboardData
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
      initial
    );
    return DashboardPanel.current;
  }

  update(data: DashboardData): void {
    this.latest = data;
    this.pushLatest();
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

  private prefs(): CurrencyPrefs {
    return getCurrencyPrefs();
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
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
