import * as vscode from "vscode";
import {
  asDateMs,
  eventCostCents,
  eventTokens,
  snapshotFromEvents,
} from "./aggregator";
import {
  buildConversationWorkspaceMap,
  canonicalizeWorkspaceIdentity,
  isCursorProjectId,
} from "./conversationWorkspaceMap";
import {
  apiConversationIds,
  type LocalConversationActivity,
} from "./localActivity";
import type { FilteredUsageEvent, UsageSnapshot, WorkspaceStat, WorkspaceStore } from "./types";
import type { LocalStore } from "./storage";
import {
  NO_WORKSPACE_ID,
  NO_WORKSPACE_LABEL,
  canonicalDisplayName,
  normalizeDisplayName,
  normalizeWorkspaceId,
} from "./workspaceLabels";

export {
  NO_WORKSPACE_ID,
  NO_WORKSPACE_LABEL,
  normalizeWorkspaceId,
} from "./workspaceLabels";

function sessionId(): string {
  return vscode.env.sessionId || "unknown-session";
}

export function currentWorkspaceIdentity(): {
  workspaceId: string;
  displayName: string;
} {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { workspaceId: NO_WORKSPACE_ID, displayName: NO_WORKSPACE_LABEL };
  }
  if (folders.length === 1) {
    const f = folders[0];
    return {
      workspaceId: normalizeWorkspaceId(f.uri.toString()),
      displayName: f.name || f.uri.fsPath,
    };
  }
  const name = vscode.workspace.name ?? folders.map((f) => f.name).join(" + ");
  const id = folders
    .map((f) => normalizeWorkspaceId(f.uri.toString()))
    .sort()
    .join("|");
  return { workspaceId: `multi:${id}`, displayName: name };
}

/**
 * Correlates usage events with workspaces on this machine.
 * Prefer conversationId → local agent-transcript project; fall back to
 * active-window time ranges while the extension was running.
 */
export class WorkspaceUsageTracker {
  constructor(private readonly store: LocalStore) {}

  async onActivate(): Promise<void> {
    const now = new Date().toISOString();
    const sid = sessionId();
    const { workspaceId, displayName } = currentWorkspaceIdentity();
    await this.store.updateWorkspaceStore((data) => {
      this.closeSessionWindows(data, sid, now);
      this.migrateLegacyNoFolder(data);
      data.windows.push({
        workspaceId,
        displayName,
        startedAt: now,
        sessionId: sid,
        lastFocusedAt: now,
      });
    });
  }

  async onWorkspaceChange(): Promise<void> {
    const now = new Date().toISOString();
    const sid = sessionId();
    const { workspaceId, displayName } = currentWorkspaceIdentity();
    await this.store.updateWorkspaceStore((data) => {
      this.closeSessionWindows(data, sid, now);
      data.windows.push({
        workspaceId,
        displayName,
        startedAt: now,
        sessionId: sid,
        lastFocusedAt: now,
      });
    });
  }

  /** Call when this Cursor window gains focus — helps multi-window fallback. */
  async onWindowFocus(): Promise<void> {
    const now = new Date().toISOString();
    const sid = sessionId();
    await this.store.updateWorkspaceStore((data) => {
      let changed = false;
      for (const w of data.windows) {
        if (!w.endedAt && w.sessionId === sid) {
          w.lastFocusedAt = now;
          changed = true;
        }
      }
      return changed; // false → skip the write entirely
    });
  }

  /**
   * Rebuild workspace stats from usage events, then overlay local-only
   * conversations (pending API) with a rough transcript token estimate.
   */
  async attributeDelta(
    events: FilteredUsageEvent[],
    totalsOverride?: {
      totalTokens: number;
      costCents: number;
      localConversations?: LocalConversationActivity[];
      rangeStartMs?: number;
      /**
       * In-window fetch succeeded with no events, and the newest event Cursor
       * has published is before this window. Drop previous-cycle billed rows.
       */
      clearStaleBilled?: boolean;
    }
  ): Promise<WorkspaceStat[]> {
    let stats: WorkspaceStat[] = [];
    // Whole rebuild runs inside the store's locked update so a concurrent
    // window's focus/refresh update cannot be overwritten by our stale copy.
    await this.store.updateWorkspaceStore((data) => {
    this.migrateLegacyNoFolder(data);
    this.migrateEstimatedFlags(data);
    const nowIso = new Date().toISOString();
    const snap = snapshotFromEvents(events);
    const pendingFlags = new Map<string, boolean>();

    // Don't wipe existing estimates when the events API returns nothing.
    // A confirmed empty window still drops previous-cycle billed rows so
    // those dollars are not shown as this cycle's usage.
    if (events.length > 0 || totalsOverride?.clearStaleBilled) {
      const byConversation = buildConversationWorkspaceMap();
      const rebuilt: WorkspaceStore["workspaces"] = {};

      for (const ev of events) {
        const tokens = eventTokens(ev);
        const cost = eventCostCents(ev);
        if (tokens <= 0 && cost <= 0) {
          continue;
        }

        const convId = eventConversationId(ev);
        const fromConvRaw = convId ? byConversation.get(convId) : undefined;
        const fromConv = fromConvRaw
          ? {
              workspaceId: normalizeWorkspaceId(fromConvRaw.workspaceId),
              displayName: fromConvRaw.displayName,
            }
          : undefined;
        const ms = asDateMs(ev.timestamp);
        const fromWindow =
          ms !== undefined ? this.workspaceAt(data, ms) : undefined;
        // Conversation mapping wins; window is only a fallback.
        const match = fromConv ?? fromWindow;
        if (!match) {
          continue;
        }

        const normalized = this.normalizeIdentity(match);
        const activeAt =
          ms !== undefined ? new Date(ms).toISOString() : nowIso;
        const entry = rebuilt[normalized.workspaceId] ?? {
          displayName: normalized.displayName,
          tokens: 0,
          costCents: 0,
          lastActiveAt: activeAt,
          tokensEstimated: false,
        };
        entry.displayName = normalized.displayName;
        entry.tokens += tokens;
        entry.costCents += cost;
        entry.tokensEstimated = false;
        const prev = Date.parse(entry.lastActiveAt);
        const next = Date.parse(activeAt);
        if (!Number.isFinite(prev) || (Number.isFinite(next) && next >= prev)) {
          entry.lastActiveAt = activeAt;
        }
        rebuilt[normalized.workspaceId] = entry;
        pendingFlags.set(normalized.workspaceId, false);
      }

      if (events.length === 0) {
        const kept: WorkspaceStore["workspaces"] = {};
        for (const [id, entry] of Object.entries(data.workspaces)) {
          if (entry.tokensEstimated === true) {
            kept[id] = entry;
          }
        }
        data.workspaces = kept;
      } else {
        data.workspaces = rebuilt;
      }
    }

    this.mergeLocalPendingWorkspaces(
      data,
      pendingFlags,
      totalsOverride?.localConversations ?? [],
      apiConversationIds(events),
      totalsOverride?.rangeStartMs
    );

    this.ensureOpenWorkspaces(data);

    data.lastSnapshot = {
      at: nowIso,
      totalTokens: totalsOverride?.totalTokens ?? snap.totalTokens,
      costCents: totalsOverride?.costCents ?? snap.costCents,
      eventCount: snap.eventCount,
    } satisfies UsageSnapshot;

    if (data.windows.length > 500) {
      data.windows = data.windows.slice(-300);
    }
    // Collapse aliases first, then persist so reloads keep one row per folder
    // and retain tokensEstimated (pending vs billed).
    stats = this.toStats(data, pendingFlags);
    });
    return stats;
  }

  /**
   * Surface workspaces that have local chats in-range but no API tokens yet.
   * Keeps refreshing the transcript token estimate until the API attributes usage.
   */
  private mergeLocalPendingWorkspaces(
    data: WorkspaceStore,
    pendingFlags: Map<string, boolean>,
    localConversations: LocalConversationActivity[],
    matchedIds: Set<string>,
    rangeStartMs?: number
  ): void {
    const estimateByWorkspace = new Map<
      string,
      { displayName: string; estimatedTokens: number; lastActiveMs: number }
    >();

    for (const local of localConversations) {
      if (matchedIds.has(local.conversationId)) {
        continue;
      }
      if (rangeStartMs !== undefined && local.lastActiveMs < rangeStartMs) {
        continue;
      }
      const normalized = this.normalizeIdentity({
        workspaceId: local.workspaceId,
        displayName: local.displayName,
      });
      const prev = estimateByWorkspace.get(normalized.workspaceId);
      if (!prev) {
        estimateByWorkspace.set(normalized.workspaceId, {
          displayName: normalized.displayName,
          estimatedTokens: Math.max(0, local.estimatedTokens || 0),
          lastActiveMs: local.lastActiveMs,
        });
        continue;
      }
      prev.displayName = normalized.displayName;
      prev.estimatedTokens += Math.max(0, local.estimatedTokens || 0);
      if (local.lastActiveMs >= prev.lastActiveMs) {
        prev.lastActiveMs = local.lastActiveMs;
      }
    }

    for (const [workspaceId, est] of estimateByWorkspace) {
      const activeAt = new Date(est.lastActiveMs).toISOString();
      const existing = data.workspaces[workspaceId];
      if (!existing) {
        data.workspaces[workspaceId] = {
          displayName: est.displayName,
          tokens: est.estimatedTokens,
          costCents: 0,
          lastActiveAt: activeAt,
          tokensEstimated: true,
        };
        pendingFlags.set(workspaceId, true);
        continue;
      }

      // API-attributed rows keep billed totals; estimates only fill/refresh
      // rows that are still provisional.
      if (existing.tokensEstimated === false) {
        existing.displayName = est.displayName;
        const prev = Date.parse(existing.lastActiveAt);
        const next = Date.parse(activeAt);
        if (!Number.isFinite(prev) || (Number.isFinite(next) && next >= prev)) {
          existing.lastActiveAt = activeAt;
        }
        continue;
      }

      existing.displayName = est.displayName;
      existing.tokens = est.estimatedTokens;
      existing.costCents = 0;
      existing.tokensEstimated = true;
      const prev = Date.parse(existing.lastActiveAt);
      const next = Date.parse(activeAt);
      if (!Number.isFinite(prev) || (Number.isFinite(next) && next >= prev)) {
        existing.lastActiveAt = activeAt;
      }
      pendingFlags.set(workspaceId, true);
    }
  }

  async getStats(): Promise<WorkspaceStat[]> {
    let stats: WorkspaceStat[] = [];
    await this.store.updateWorkspaceStore((data) => {
      this.migrateLegacyNoFolder(data);
      this.migrateEstimatedFlags(data);
      this.ensureOpenWorkspaces(data);
      stats = this.toStats(data);
    });
    return stats;
  }

  async clear(): Promise<void> {
    await this.store.clearWorkspaceStats();
    await this.onActivate();
  }

  /** Close only this Cursor window's open periods — leave other windows alone. */
  private closeSessionWindows(
    data: WorkspaceStore,
    sid: string,
    endedAt: string
  ): void {
    for (const w of data.windows) {
      if (w.endedAt) {
        continue;
      }
      // Legacy rows without sessionId: only this activation may close them once.
      if (!w.sessionId || w.sessionId === sid) {
        w.endedAt = endedAt;
        if (!w.sessionId) {
          w.sessionId = sid;
        }
      }
    }
  }

  /** Surface every still-open folder (all Cursor windows) plus this window's folder. */
  private ensureOpenWorkspaces(data: WorkspaceStore): void {
    const ensure = (workspaceId: string, displayName: string) => {
      const norm = this.normalizeIdentity({ workspaceId, displayName });
      const existing = data.workspaces[norm.workspaceId];
      if (existing) {
        existing.displayName = norm.displayName;
        return;
      }
      data.workspaces[norm.workspaceId] = {
        displayName: norm.displayName,
        tokens: 0,
        costCents: 0,
        lastActiveAt: new Date().toISOString(),
      };
    };

    const identity = currentWorkspaceIdentity();
    ensure(identity.workspaceId, identity.displayName);

    for (const w of data.windows) {
      if (!w.endedAt) {
        ensure(w.workspaceId, w.displayName);
      }
    }
  }

  /**
   * Older stores had no tokensEstimated flag, so local estimates looked like
   * final billed totals after reload and stopped updating. Infer pending when
   * the row has tokens but no API cost yet.
   */
  private migrateEstimatedFlags(data: WorkspaceStore): void {
    for (const entry of Object.values(data.workspaces)) {
      if (entry.tokensEstimated !== undefined) {
        continue;
      }
      if ((entry.tokens ?? 0) > 0 && (entry.costCents ?? 0) <= 0) {
        entry.tokensEstimated = true;
      } else if ((entry.tokens ?? 0) > 0 || (entry.costCents ?? 0) > 0) {
        entry.tokensEstimated = false;
      }
    }
  }

  /** Rename legacy "(no folder)" / no-folder ids to the current label. */
  private migrateLegacyNoFolder(data: WorkspaceStore): void {
    const legacy = data.workspaces["no-folder"];
    if (legacy) {
      const dest = data.workspaces[NO_WORKSPACE_ID];
      if (dest) {
        dest.tokens += legacy.tokens;
        dest.costCents += legacy.costCents;
        if (Date.parse(legacy.lastActiveAt) > Date.parse(dest.lastActiveAt)) {
          dest.lastActiveAt = legacy.lastActiveAt;
        }
        dest.displayName = NO_WORKSPACE_LABEL;
      } else {
        data.workspaces[NO_WORKSPACE_ID] = {
          ...legacy,
          displayName: NO_WORKSPACE_LABEL,
        };
      }
      delete data.workspaces["no-folder"];
    }

    for (const entry of Object.values(data.workspaces)) {
      if (entry.displayName === "(no folder)") {
        entry.displayName = NO_WORKSPACE_LABEL;
      }
    }

    for (const w of data.windows) {
      if (w.workspaceId === "no-folder" || w.displayName === "(no folder)") {
        w.workspaceId = NO_WORKSPACE_ID;
        w.displayName = NO_WORKSPACE_LABEL;
      }
    }
  }

  private normalizeIdentity(match: {
    workspaceId: string;
    displayName: string;
  }): { workspaceId: string; displayName: string } {
    return canonicalizeWorkspaceIdentity(match);
  }

  /**
   * Workspace covering `ms`. If several different folders overlap (multi-window),
   * prefer the most recently focused; if still tied/ambiguous, skip fallback.
   */
  private workspaceAt(
    data: WorkspaceStore,
    ms: number
  ): { workspaceId: string; displayName: string } | undefined {
    const hits: Array<{
      workspaceId: string;
      displayName: string;
      startedAt: number;
      lastFocusedAt: number;
    }> = [];

    for (const w of data.windows) {
      const start = Date.parse(w.startedAt);
      if (!Number.isFinite(start) || ms < start) {
        continue;
      }
      const end = w.endedAt ? Date.parse(w.endedAt) : Date.now();
      if (!Number.isFinite(end) || ms > end) {
        continue;
      }
      hits.push({
        workspaceId: normalizeWorkspaceId(w.workspaceId),
        displayName: w.displayName,
        startedAt: start,
        lastFocusedAt: Date.parse(w.lastFocusedAt || w.startedAt) || start,
      });
    }

    if (!hits.length) {
      return undefined;
    }

    const uniqueIds = new Set(hits.map((h) => h.workspaceId));
    if (uniqueIds.size === 1) {
      const h = hits[0];
      return this.normalizeIdentity({
        workspaceId: h.workspaceId,
        displayName: h.displayName,
      });
    }

    // Concurrent folders: pick most recently focused at/before the event.
    const focused = hits
      .filter((h) => h.lastFocusedAt <= ms)
      .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt || b.startedAt - a.startedAt);
    if (focused.length && focused[0].lastFocusedAt > 0) {
      // Only trust if the winner is uniquely most recent.
      if (
        focused.length === 1 ||
        focused[0].lastFocusedAt > focused[1].lastFocusedAt
      ) {
        return this.normalizeIdentity({
          workspaceId: focused[0].workspaceId,
          displayName: focused[0].displayName,
        });
      }
    }

    return undefined;
  }

  private toStats(
    data: WorkspaceStore,
    pendingFlags?: Map<string, boolean>
  ): WorkspaceStat[] {
    type Acc = WorkspaceStat & { fromAliasOnly: boolean };

    // Merge alias ids (cursor-project / alternate paths) onto one row.
    const byId = new Map<string, Acc>();
    for (const [workspaceId, v] of Object.entries(data.workspaces)) {
      const norm = this.normalizeIdentity({
        workspaceId,
        displayName: v.displayName,
      });
      const tokens = Math.round(v.tokens);
      const costCents = Math.round(v.costCents * 100) / 100;
      const alias = isCursorProjectId(workspaceId);
      const flagged =
        pendingFlags?.get(workspaceId) === true ||
        pendingFlags?.get(norm.workspaceId) === true;
      const apiAttributed =
        pendingFlags?.get(workspaceId) === false ||
        pendingFlags?.get(norm.workspaceId) === false ||
        v.tokensEstimated === false;
      // Prefer explicit store/API attribution over alias/pending heuristics.
      const estimated =
        !apiAttributed &&
        (alias || flagged || v.tokensEstimated === true);

      const prev = byId.get(norm.workspaceId);
      if (!prev) {
        const pending = estimated && tokens > 0;
        byId.set(norm.workspaceId, {
          workspaceId: norm.workspaceId,
          displayName: norm.displayName,
          tokens,
          costCents,
          lastActiveAt: v.lastActiveAt,
          localPending: pending,
          tokensEstimated: pending,
          fromAliasOnly: alias,
        });
        continue;
      }

      this.mergeWorkspaceAcc(prev, {
        displayName: norm.displayName,
        tokens,
        costCents,
        lastActiveAt: v.lastActiveAt,
        estimated,
        alias,
      });
    }

    // Safety net: same display name (Usage_Dashboard vs Usage-Dashboard).
    const byName = new Map<string, Acc>();
    for (const row of byId.values()) {
      const key = normalizeDisplayName(row.displayName);
      const prev = byName.get(key);
      if (!prev) {
        byName.set(key, row);
        continue;
      }
      this.mergeWorkspaceAcc(prev, {
        displayName: preferDisplayName(prev.displayName, row.displayName),
        tokens: row.tokens,
        costCents: row.costCents,
        lastActiveAt: row.lastActiveAt,
        estimated: !!row.tokensEstimated,
        alias: row.fromAliasOnly,
      });
      // Prefer a real file:/no-workspace id over a leftover alias id.
      if (prev.fromAliasOnly && !row.fromAliasOnly) {
        prev.workspaceId = row.workspaceId;
        prev.fromAliasOnly = false;
      }
    }

    const stats = [...byName.values()].map(({ fromAliasOnly: _, ...rest }) => {
      const localPending = !!rest.tokensEstimated && rest.tokens > 0;
      return {
        ...rest,
        localPending,
        tokensEstimated: localPending,
      } satisfies WorkspaceStat;
    });

    // Persist collapsed keys so the next load does not revive duplicates.
    const collapsed: WorkspaceStore["workspaces"] = {};
    for (const s of stats) {
      collapsed[s.workspaceId] = {
        displayName: s.displayName,
        tokens: s.tokens,
        costCents: s.costCents,
        lastActiveAt: s.lastActiveAt,
        tokensEstimated: s.tokensEstimated === true ? true : false,
      };
      // Open folders with 0 tokens are neither estimated nor attributed yet.
      if (s.tokens <= 0 && s.costCents <= 0) {
        delete collapsed[s.workspaceId].tokensEstimated;
      }
    }
    data.workspaces = collapsed;

    return stats.sort(
      (a, b) =>
        Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt) ||
        b.costCents - a.costCents ||
        b.tokens - a.tokens
    );
  }

  /**
   * Fold one workspace row into another. Alias/estimate totals do not stack
   * on top of already-attributed API figures (same rule as same-id merge).
   */
  private mergeWorkspaceAcc(
    into: WorkspaceStat & { fromAliasOnly: boolean },
    from: {
      displayName: string;
      tokens: number;
      costCents: number;
      lastActiveAt: string;
      estimated: boolean;
      alias: boolean;
    }
  ): void {
    const intoEstimated = !!into.tokensEstimated;
    const fromEstimated = from.estimated;

    if (intoEstimated && !fromEstimated) {
      into.tokens = from.tokens;
      into.costCents = from.costCents;
      into.localPending = false;
      into.tokensEstimated = false;
      into.fromAliasOnly = false;
    } else if (!intoEstimated && fromEstimated) {
      // Keep attributed totals; estimates only fill empty rows.
    } else if (intoEstimated && fromEstimated) {
      // Both provisional: keep the larger fresh estimate (do not double-count
      // alias + file:// copies of the same local chats).
      if (from.tokens >= into.tokens) {
        into.tokens = from.tokens;
      }
      into.costCents = 0;
      into.localPending = into.tokens > 0;
      into.tokensEstimated = into.tokens > 0;
    } else {
      into.tokens += from.tokens;
      into.costCents =
        Math.round((into.costCents + from.costCents) * 100) / 100;
      into.localPending = false;
      into.tokensEstimated = false;
    }

    if (Date.parse(from.lastActiveAt) > Date.parse(into.lastActiveAt)) {
      into.lastActiveAt = from.lastActiveAt;
    }
    into.displayName = preferDisplayName(into.displayName, from.displayName);
    if (!from.alias) {
      into.fromAliasOnly = false;
    }
  }
}

function preferDisplayName(a: string, b: string): string {
  // Known renames (AnonBrowser → MintShield): always keep the current name.
  const canonA = canonicalDisplayName(a);
  const canonB = canonicalDisplayName(b);
  if (canonA !== a || canonB !== b) {
    if (normalizeDisplayName(canonA) === normalizeDisplayName(canonB)) {
      return canonA !== a ? canonA : canonB !== b ? canonB : canonA;
    }
    if (canonA !== a) {
      return canonA;
    }
    if (canonB !== b) {
      return canonB;
    }
  }
  // Prefer real folder names (underscores) over slug tails (hyphens).
  if (a.includes("_") && !b.includes("_")) {
    return a;
  }
  if (b.includes("_") && !a.includes("_")) {
    return b;
  }
  return a.length >= b.length ? a : b;
}

/** conversationId / composerId / chatId — Cursor payloads vary by version. */
function eventConversationId(ev: FilteredUsageEvent): string | undefined {
  for (const key of [
    "conversationId",
    "composerId",
    "chatId",
    "composer_id",
    "conversation_id",
  ] as const) {
    const v = ev[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}
