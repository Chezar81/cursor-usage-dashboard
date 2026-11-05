import * as vscode from "vscode";
import { setAppearance, type DashboardAppearance } from "./appearance";
import {
  asDateMs,
  buildDashboardData,
  filterEventsToRange,
  resolveCycleRange,
} from "./aggregator";
import { watchBundleReload } from "./bundleReload";
import {
  formatMoneyFromUsdCents,
  getCurrencyPrefs,
  setDisplayCurrency,
  type DisplayCurrency,
} from "./currency";
import {
  CursorAuthError,
  CursorDashboardClient,
  TOKEN_SECRET_KEY,
} from "./cursorClient";
import {
  contextUsageEqual,
  emptyContextUsage,
  estimateContextUsage,
} from "./contextEstimator";
import { DashboardPanel } from "./dashboardPanel";
import { scanLocalConversationActivity } from "./localActivity";
import {
  mergeLocalModelActivity,
  scanComposerModelActivity,
  scanLocalModelActivity,
} from "./localModelActivity";
import { resolveIdeSessionCookie } from "./localAuth";
import { LocalStore } from "./storage";
import type { DashboardData } from "./types";
import { WorkspaceUsageTracker } from "./workspaceTracker";

/** Local-only Context Usage poll while the dashboard webview is open. */
const CONTEXT_POLL_MS = 5_000;

let statusBar: vscode.StatusBarItem;
let client: CursorDashboardClient;
let store: LocalStore;
let tracker: WorkspaceUsageTracker;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let contextPollTimer: ReturnType<typeof setInterval> | undefined;
let lastData: DashboardData | undefined;
let refreshing = false;
let contextRefreshing = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  watchBundleReload(context);
  store = new LocalStore(context.globalStorageUri);
  tracker = new WorkspaceUsageTracker(store);
  client = new CursorDashboardClient(() => resolveSessionToken(context));

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "cursorUsage.openDashboard";
  statusBar.tooltip = "Open Cursor Usage Dashboard";
  statusBar.text = "$(dashboard) Usage: —";
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorUsage.openDashboard", () =>
      openDashboard(context)
    ),
    vscode.commands.registerCommand("cursorUsage.refresh", () => refresh(context)),
    vscode.commands.registerCommand("cursorUsage.setSessionToken", () =>
      setSessionToken(context)
    ),
    vscode.commands.registerCommand("cursorUsage.clearWorkspaceStats", () =>
      clearWorkspaceStats()
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void tracker.onWorkspaceChange();
    })
  );

  await tracker.onActivate();

  const cached = await store.loadCachedDashboard();
  if (cached) {
    lastData = {
      ...cached,
      contextUsage: cached.contextUsage ?? emptyContextUsage(),
    };
    updateStatusBar(lastData);
  }

  scheduleAutoRefresh(context);
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) {
        void tracker.onWindowFocus();
        scheduleAutoRefresh(context);
        void refresh(context, { silent: true });
        if (DashboardPanel.current) {
          void refreshContextUsageOnly();
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      DashboardPanel.current?.refreshPrefs();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("cursorUsage.currency") ||
        e.affectsConfiguration("cursorUsage.eurPerUsd") ||
        e.affectsConfiguration("cursorUsage.appearance")
      ) {
        if (lastData) {
          updateStatusBar(lastData);
        }
        DashboardPanel.current?.refreshPrefs();
      }
      if (e.affectsConfiguration("cursorUsage.refreshIntervalMinutes")) {
        scheduleAutoRefresh(context);
      }
    })
  );

  // Initial soft refresh (non-blocking).
  void refresh(context, { silent: true });
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  stopContextPoll();
}

function openDashboard(context: vscode.ExtensionContext): void {
  DashboardPanel.show(
    context.extensionUri,
    () => {
      void refresh(context);
    },
    () => {
      void setSessionToken(context);
    },
    (currency: DisplayCurrency) => {
      void setDisplayCurrency(currency);
    },
    (appearance: DashboardAppearance) => {
      void setAppearance(appearance);
    },
    lastData,
    () => stopContextPoll()
  );
  scheduleContextPoll();
  // Always refresh: cached data is seeded into the panel for instant paint.
  void refresh(context, { silent: !!lastData });
}

function scheduleContextPoll(): void {
  if (contextPollTimer) {
    return;
  }
  void refreshContextUsageOnly();
  contextPollTimer = setInterval(() => {
    void refreshContextUsageOnly();
  }, CONTEXT_POLL_MS);
}

function stopContextPoll(): void {
  if (contextPollTimer) {
    clearInterval(contextPollTimer);
    contextPollTimer = undefined;
  }
}

/**
 * Re-read Cursor's local composer context tray and patch the webview.
 * No cursor.com API traffic; skipped when a full refresh is running or the
 * dashboard tab is hidden / window unfocused.
 */
async function refreshContextUsageOnly(): Promise<void> {
  if (refreshing || contextRefreshing) {
    return;
  }
  const panel = DashboardPanel.current;
  if (!panel?.isVisible() || !vscode.window.state.focused) {
    return;
  }
  contextRefreshing = true;
  try {
    const contextUsage = await estimateContextUsage(
      vscode.workspace.workspaceFolders
    );
    if (!lastData) {
      return;
    }
    if (contextUsageEqual(lastData.contextUsage, contextUsage)) {
      return;
    }
    lastData = { ...lastData, contextUsage };
    panel.updateContextUsage(contextUsage);
  } finally {
    contextRefreshing = false;
  }
}

/**
 * Prefer the session already stored by the Cursor IDE (state.vscdb).
 * Manual SecretStorage token is only a fallback.
 */
async function resolveSessionToken(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  try {
    const ide = await resolveIdeSessionCookie();
    if (ide) {
      return ide;
    }
  } catch {
    // fall through to manual token
  }
  return context.secrets.get(TOKEN_SECRET_KEY);
}

async function setSessionToken(context: vscode.ExtensionContext): Promise<void> {
  const ide = await resolveIdeSessionCookie().catch(() => undefined);
  if (ide) {
    const choice = await vscode.window.showInformationMessage(
      "Cursor login detected automatically — no browser cookie needed. Refresh the dashboard?",
      "Refresh",
      "Set manual fallback anyway"
    );
    if (choice === "Refresh") {
      await refresh(context);
      return;
    }
    if (choice !== "Set manual fallback anyway") {
      return;
    }
  }

  const value = await vscode.window.showInputBox({
    title: "Manual session token (fallback)",
    prompt:
      "Only needed if auto-login fails. Paste WorkosCursorSessionToken from cursor.com cookies.",
    placeHolder: "WorkosCursorSessionToken value",
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    await context.secrets.delete(TOKEN_SECRET_KEY);
    vscode.window.showInformationMessage("Manual session token cleared.");
    return;
  }
  await context.secrets.store(TOKEN_SECRET_KEY, trimmed);
  vscode.window.showInformationMessage("Manual session token saved (fallback).");
  await refresh(context);
}

async function clearWorkspaceStats(): Promise<void> {
  await tracker.clear();
  if (lastData) {
    lastData = { ...lastData, workspaces: await tracker.getStats() };
    DashboardPanel.current?.update(lastData);
  }
  vscode.window.showInformationMessage("Local workspace usage stats cleared.");
}

function scheduleAutoRefresh(context: vscode.ExtensionContext): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  const minutes = vscode.workspace
    .getConfiguration("cursorUsage")
    .get<number>("refreshIntervalMinutes", 2);
  const ms = Math.max(1, minutes) * 60_000;
  refreshTimer = setInterval(() => {
    if (vscode.window.state.focused) {
      void refresh(context, { silent: true });
    }
  }, ms);
}

async function refresh(
  context: vscode.ExtensionContext,
  opts?: { silent?: boolean }
): Promise<void> {
  if (refreshing) {
    return;
  }
  refreshing = true;
  if (!opts?.silent) {
    statusBar.text = "$(sync~spin) Usage: refreshing…";
  }

  try {
    const token = await resolveSessionToken(context);
    if (!token?.trim()) {
      const data = emptyData(
        "Could not read your Cursor login from this machine. Sign in to Cursor, then refresh. Manual cookie paste is only a fallback.",
        true
      );
      data.workspaces = await tracker.getStats();
      data.contextUsage = await estimateContextUsage(
        vscode.workspace.workspaceFolders
      );
      await publish(data);
      if (!opts?.silent) {
        vscode.window.showWarningMessage(data.error!);
      }
      return;
    }

    // One flaky endpoint must not blank the whole dashboard; auth still fails fast.
    const [meR, summaryR, periodR, sandR, prepaidR, analyticsR] =
      await Promise.allSettled([
        client.getAuthMe(),
        client.getUsageSummary(),
        client.getCurrentPeriodUsage(),
        client.getSandUsageStatus(),
        client.getUserPrepaidBilling(),
        client.getUserAnalytics(),
      ]);
    for (const r of [meR, summaryR, periodR, sandR, prepaidR, analyticsR]) {
      if (r.status === "rejected" && r.reason instanceof CursorAuthError) {
        throw r.reason;
      }
    }
    const me = meR.status === "fulfilled" ? meR.value : undefined;
    const summary = summaryR.status === "fulfilled" ? summaryR.value : undefined;
    const period = periodR.status === "fulfilled" ? periodR.value : null;
    const sand = sandR.status === "fulfilled" ? sandR.value : null;
    const prepaid = prepaidR.status === "fulfilled" ? prepaidR.value : null;
    const analytics =
      analyticsR.status === "fulfilled" ? analyticsR.value : null;
    const { startMs, endMs, rangeKind } = resolveCycleRange(
      summary,
      period,
      sand
    );

    // Local-first: scan transcripts + tracking DB so Models/Trend fill before API.
    const localScan = scanLocalConversationActivity({
      sinceMs: startMs - 2 * 86400000,
    });
    // AI code-tracking only lists chats that produced code hashes;
    // composerData (state.vscdb) carries the picker model for every chat.
    const localModels = mergeLocalModelActivity([
      scanLocalModelActivity({
        sinceMs: startMs - 2 * 86400000,
        untilMs: endMs,
      }),
      scanComposerModelActivity(),
    ]);

    let aggregated;
    let filtered;
    let eventsAuthoritative = false;
    try {
      aggregated = await client.getAggregatedUsageEvents({
        startDate: startMs,
        endDate: endMs,
      });
    } catch (e) {
      if (e instanceof CursorAuthError) {
        throw e;
      }
      // Best-effort: continue with filtered events.
    }

    let usageEventsFetchStrategy:
      | "primary"
      | "primary-seconds"
      | "wide-30d"
      | "unbounded"
      | "empty" = "empty";
    try {
      const loaded = await client.getAllFilteredUsageEventsWithFallback({
        startDate: startMs,
        endDate: endMs,
        pageSize: 500,
      });
      filtered = loaded.response;
      usageEventsFetchStrategy = loaded.fetchStrategy;
      eventsAuthoritative = true;
    } catch (e) {
      if (e instanceof CursorAuthError) {
        throw e;
      }
    }

    let events = filtered?.usageEventsDisplay ?? [];
    if (
      usageEventsFetchStrategy === "primary-seconds" ||
      usageEventsFetchStrategy === "wide-30d" ||
      usageEventsFetchStrategy === "unbounded"
    ) {
      events = filterEventsToRange(events, startMs, endMs);
      filtered = {
        ...filtered,
        usageEventsDisplay: events,
        totalUsageEventsCount: events.length,
      };
    }
    let latestKnownEventMs: number | undefined;
    let latestPeekOk = false;
    if (eventsAuthoritative && events.length === 0) {
      const peek = await client.peekLatestUsageEvent();
      latestPeekOk = peek.ok;
      if (peek.ok && peek.event) {
        latestKnownEventMs = asDateMs(peek.event.timestamp);
      }
    }
    const clearStaleBilled =
      eventsAuthoritative &&
      events.length === 0 &&
      latestPeekOk &&
      (latestKnownEventMs === undefined || latestKnownEventMs < startMs);
    const data = buildDashboardData({
      summary,
      me,
      aggregated,
      filtered,
      sand,
      period,
      prepaid,
      analytics,
      rangeStartMs: startMs,
      rangeEndMs: endMs,
      rangeKind,
      latestKnownEventMs,
      usageEventsFetchStrategy,
      localConversations: localScan.conversations,
      localModels,
      workspaces: [],
      contextUsage: emptyContextUsage(),
    });
    const totalTokens =
      data.totals.inputTokens +
      data.totals.outputTokens +
      data.totals.cacheReadTokens +
      data.totals.cacheWriteTokens;
    data.workspaces = await tracker.attributeDelta(events, {
      totalTokens,
      costCents: data.totals.costCents,
      localConversations: localScan.conversations,
      rangeStartMs: startMs,
      clearStaleBilled,
    });
    data.contextUsage = await estimateContextUsage(
      vscode.workspace.workspaceFolders
    );

    await publish(data);
    // Best-effort raw payload backup (view model is already cached in publish).
    void store
      .saveRawSnapshot({
        savedAt: data.fetchedAt,
        me,
        summary,
        period,
        sand,
        prepaid,
        analytics,
        aggregated,
        filtered,
        localConversations: localScan.conversations,
        localModels,
        rangeStartMs: startMs,
        rangeEndMs: endMs,
        rangeKind,
      })
      .catch(() => undefined);
  } catch (e) {
    const authError = e instanceof CursorAuthError;
    const message =
      e instanceof Error ? e.message : "Failed to refresh Cursor usage.";
    const workspaces = await tracker.getStats();
    const base =
      lastData ??
      (await store.loadCachedDashboard()) ??
      emptyData(message, authError);
    const data: DashboardData = {
      ...base,
      fetchedAt: new Date().toISOString(),
      workspaces,
      contextUsage: await estimateContextUsage(
        vscode.workspace.workspaceFolders
      ),
      error: message,
      authError,
    };
    await publish(data, { skipCache: true });
    if (!opts?.silent) {
      vscode.window.showErrorMessage(message);
    }
  } finally {
    refreshing = false;
  }
}

async function publish(
  data: DashboardData,
  opts?: { skipCache?: boolean }
): Promise<void> {
  lastData = data;
  if (!opts?.skipCache && !data.authError && !data.error) {
    await store.saveCachedDashboard(data);
  }
  updateStatusBar(data);
  DashboardPanel.current?.update(data);
}

function updateStatusBar(data: DashboardData): void {
  if (data.authError) {
    statusBar.text = "$(warning) Usage: auth";
    return;
  }
  if (data.error && !data.plan) {
    statusBar.text = "$(error) Usage: error";
    return;
  }
  const pct = data.plan?.includedPercentUsed;
  const onDemand = data.plan?.onDemandUsedCents;
  const credits = data.plan?.creditsAvailableCents;
  const parts: string[] = [];
  if (pct != null && Number.isFinite(pct)) {
    parts.push(`${pct.toFixed(0)}%`);
  }
  if (onDemand != null && onDemand > 0) {
    parts.push(`+${formatMoneyFromUsdCents(onDemand, getCurrencyPrefs())}`);
  }
  if (credits != null && credits > 0) {
    parts.push(`${formatMoneyFromUsdCents(credits, getCurrencyPrefs())} cr`);
  }
  const label = parts.length ? parts.join(" ") : "ok";
  statusBar.text = `$(dashboard) Usage: ${label}`;
}

function emptyData(error: string, authError: boolean): DashboardData {
  return {
    fetchedAt: new Date().toISOString(),
    plan: {
      membershipType: "—",
      includedPercentUsed: null,
      onDemandUsedCents: null,
      onDemandEnabled: false,
    },
    models: [],
    daily: [],
    sessions: [],
    trend: {
      rangeKind: "monthly",
      pendingConversations: 0,
      matchedConversations: 0,
      eventsStale: false,
    },
    workspaces: [],
    contextUsage: emptyContextUsage(),
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costCents: 0,
    },
    error,
    authError,
  };
}
