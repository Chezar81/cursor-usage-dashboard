import * as vscode from "vscode";
import {
  asDateMs,
  eventCostCents,
  eventTokens,
  snapshotFromEvents,
} from "./aggregator";
import { buildConversationWorkspaceMap } from "./conversationWorkspaceMap";
import {
  apiConversationIds,
  type LocalConversationActivity,
} from "./localActivity";
import type { FilteredUsageEvent, UsageSnapshot, WorkspaceStat, WorkspaceStore } from "./types";
import type { LocalStore } from "./storage";
import {
  NO_WORKSPACE_ID,
  NO_WORKSPACE_LABEL,
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
    const data = await this.store.loadWorkspaceStore();
    const now = new Date().toISOString();
    const sid = sessionId();
    this.closeSessionWindows(data, sid, now);
    this.migrateLegacyNoFolder(data);
    const { workspaceId, displayName } = currentWorkspaceIdentity();
    data.windows.push({
      workspaceId,
      displayName,
      startedAt: now,
      sessionId: sid,
      lastFocusedAt: now,
    });
    await this.store.saveWorkspaceStore(data);
  }

  async onWorkspaceChange(): Promise<void> {
    const data = await this.store.loadWorkspaceStore();
    const now = new Date().toISOString();
    const sid = sessionId();
    this.closeSessionWindows(data, sid, now);
    const { workspaceId, displayName } = currentWorkspaceIdentity();
    data.windows.push({
      workspaceId,
      displayName,
      startedAt: now,
      sessionId: sid,
      lastFocusedAt: now,
    });
    await this.store.saveWorkspaceStore(data);
  }

  /** Call when this Cursor window gains focus — helps multi-window fallback. */
  async onWindowFocus(): Promise<void> {
    const data = await this.store.loadWorkspaceStore();
    const now = new Date().toISOString();
    const sid = sessionId();
    let changed = false;
    for (const w of data.windows) {
      if (!w.endedAt && w.sessionId === sid) {
        w.lastFocusedAt = now;
        changed = true;
      }
    }
    if (changed) {
      await this.store.saveWorkspaceStore(data);
    }
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
    }
  ): Promise<WorkspaceStat[]> {
    const data = await this.store.loadWorkspaceStore();
    this.migrateLegacyNoFolder(data);
    const nowIso = new Date().toISOString();
    const snap = snapshotFromEvents(events);
    const pendingFlags = new Map<string, boolean>();

    // Don't wipe existing estimates when the events API returns nothing.
    if (events.length > 0) {
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
        };
        entry.displayName = normalized.displayName;
        entry.tokens += tokens;
        entry.costCents += cost;
        const prev = Date.parse(entry.lastActiveAt);
        const next = Date.parse(activeAt);
        if (!Number.isFinite(prev) || (Number.isFinite(next) && next >= prev)) {
          entry.lastActiveAt = activeAt;
        }
        rebuilt[normalized.workspaceId] = entry;
        pendingFlags.set(normalized.workspaceId, false);
      }

      data.workspaces = rebuilt;
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
    await this.store.saveWorkspaceStore(data);
    return this.toStats(data, pendingFlags);
  }

  /**
   * Surface workspaces that have local chats in-range but no API tokens yet.
   * Fills a rough transcript token estimate until the API attributes usage.
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
        };
        pendingFlags.set(workspaceId, true);
        continue;
      }
      existing.displayName = est.displayName;
      const prev = Date.parse(existing.lastActiveAt);
      const next = Date.parse(activeAt);
      if (!Number.isFinite(prev) || (Number.isFinite(next) && next >= prev)) {
        existing.lastActiveAt = activeAt;
      }
      // Only replace with the estimate when API has not attributed tokens yet.
      if ((existing.tokens ?? 0) <= 0 && (existing.costCents ?? 0) <= 0) {
        existing.tokens = est.estimatedTokens;
        pendingFlags.set(workspaceId, true);
      }
    }
  }

  async getStats(): Promise<WorkspaceStat[]> {
    const data = await this.store.loadWorkspaceStore();
    this.migrateLegacyNoFolder(data);
    this.ensureOpenWorkspaces(data);
    await this.store.saveWorkspaceStore(data);
    return this.toStats(data);
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
      const id = normalizeWorkspaceId(workspaceId);
      const existing = data.workspaces[id];
      if (existing) {
        existing.displayName = displayName;
        return;
      }
      data.workspaces[id] = {
        displayName,
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
    if (
      match.workspaceId === "no-folder" ||
      match.workspaceId === NO_WORKSPACE_ID ||
      match.displayName === "(no folder)" ||
      match.displayName === NO_WORKSPACE_LABEL
    ) {
      return { workspaceId: NO_WORKSPACE_ID, displayName: NO_WORKSPACE_LABEL };
    }
    return {
      workspaceId: normalizeWorkspaceId(match.workspaceId),
      displayName: match.displayName,
    };
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
    // Merge duplicate ids after normalization.
    const merged = new Map<string, WorkspaceStat>();
    for (const [workspaceId, v] of Object.entries(data.workspaces)) {
      const norm = this.normalizeIdentity({
        workspaceId,
        displayName: v.displayName,
      });
      const prev = merged.get(norm.workspaceId);
      if (!prev) {
        const localPending = pendingFlags?.get(norm.workspaceId) === true;
        merged.set(norm.workspaceId, {
          workspaceId: norm.workspaceId,
          displayName: norm.displayName,
          tokens: Math.round(v.tokens),
          costCents: Math.round(v.costCents * 100) / 100,
          lastActiveAt: v.lastActiveAt,
          localPending,
          tokensEstimated: localPending && Math.round(v.tokens) > 0,
        });
        continue;
      }
      prev.tokens += Math.round(v.tokens);
      prev.costCents =
        Math.round((prev.costCents + v.costCents) * 100) / 100;
      if (Date.parse(v.lastActiveAt) > Date.parse(prev.lastActiveAt)) {
        prev.lastActiveAt = v.lastActiveAt;
      }
      prev.displayName = norm.displayName;
      if (pendingFlags?.get(norm.workspaceId) === true) {
        prev.localPending = true;
        prev.tokensEstimated = prev.tokens > 0;
      }
    }

    return [...merged.values()].sort(
      (a, b) =>
        Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt) ||
        b.costCents - a.costCents ||
        b.tokens - a.tokens
    );
  }
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
