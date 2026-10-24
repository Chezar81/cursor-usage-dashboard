import { dayKeyLocal, eachLocalDayKeys } from "./dates";
import type { LocalConversationActivity } from "./localActivity";
import { apiConversationIds, extractConversationId } from "./localActivity";
import {
  formatLocalModelLabel,
  type LocalModelActivity,
} from "./localModelActivity";
import type {
  AggregatedUsageEventsResponse,
  AuthMe,
  ContextUsageView,
  DailyPoint,
  DashboardData,
  FilteredUsageEvent,
  FilteredUsageEventsResponse,
  ModelBreakdown,
  PeriodUsage,
  PlanView,
  SandUsageStatus,
  TrendMeta,
  TrendRangeKind,
  UsageSummary,
  WorkspaceStat,
} from "./types";

export { dayKeyLocal } from "./dates";

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function asDateMs(v: string | number | undefined | null): number | undefined {
  if (v === undefined || v === null || v === "") {
    return undefined;
  }
  if (typeof v === "number") {
    // Cursor sometimes sends seconds.
    return v < 1e12 ? v * 1000 : v;
  }
  const trimmed = String(v).trim();
  // Numeric epoch as string (common in dashboard event payloads; mtime may be float).
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      return undefined;
    }
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(trimmed);
  return Number.isFinite(t) ? t : undefined;
}

function toIsoMaybe(v: string | number | undefined | null): string | undefined {
  const ms = asDateMs(v ?? undefined);
  if (ms === undefined) {
    return typeof v === "string" && v.includes("T") ? v : undefined;
  }
  return new Date(ms).toISOString();
}

export function eventCostCents(ev: FilteredUsageEvent): number {
  if (typeof ev.chargedCents === "number") {
    return ev.chargedCents;
  }
  if (typeof ev.costCents === "number") {
    return ev.costCents;
  }
  if (typeof ev.usageBasedCosts === "number") {
    return ev.usageBasedCosts;
  }
  if (typeof ev.usageBasedCosts === "string") {
    // Often a dollar string like "0.12"
    const n = Number(ev.usageBasedCosts.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) {
      // Heuristic: values < 50 are dollars → cents; larger already cents-ish.
      return n < 50 && n !== Math.floor(n) ? Math.round(n * 100) : Math.round(n);
    }
  }
  return 0;
}

export function eventTokens(ev: FilteredUsageEvent): number {
  const t = ev.tokenUsage;
  if (!t) {
    return 0;
  }
  return (
    num(t.inputTokens) +
    num(t.outputTokens) +
    num(t.cacheReadTokens) +
    num(t.cacheWriteTokens)
  );
}

function normalizePercent(pct: number | undefined | null): number | null {
  if (pct == null || !Number.isFinite(pct)) {
    return null;
  }
  // API returns 0–100 already (e.g. 8.69); keep as-is. Fractions ≤1 → ×100.
  return pct > 0 && pct <= 1 ? pct * 100 : pct;
}

export function buildPlanView(
  summary: UsageSummary | undefined,
  me: AuthMe | undefined,
  sand: SandUsageStatus | null | undefined,
  period: PeriodUsage | null | undefined
): PlanView {
  const individual = summary?.individualUsage;
  const plan = individual?.plan ?? summary?.planUsage;
  const onDemand = individual?.onDemand;

  let includedUsed: number | undefined;
  let includedLimit: number | undefined;
  if (plan) {
    includedUsed = num((plan as { used?: number }).used);
    includedLimit = num((plan as { limit?: number }).limit);
  }

  // Grok Overview uses weekly sand / current-period %, not monthly usage-summary (often 0%).
  const sandPct = normalizePercent(
    typeof sand?.usagePercent === "number" ? sand.usagePercent : undefined
  );
  const periodPct = normalizePercent(period?.planUsage?.totalPercentUsed);
  let summaryPct: number | null = null;
  if (plan) {
    const pct = (plan as { totalPercentUsed?: number }).totalPercentUsed;
    if (typeof pct === "number") {
      summaryPct = normalizePercent(pct);
    } else if (includedLimit && includedLimit > 0) {
      summaryPct = (num(includedUsed) / includedLimit) * 100;
    }
  }

  // Prefer non-zero weekly signal when summary is still 0 mid-cycle.
  let includedPercentUsed: number | null = null;
  let includedLabel = "Included usage";
  if (sandPct != null && (sandPct > 0 || summaryPct === 0 || summaryPct == null)) {
    includedPercentUsed = sandPct;
    includedLabel = "Weekly included usage";
  } else if (periodPct != null && (periodPct > 0 || summaryPct === 0 || summaryPct == null)) {
    includedPercentUsed = periodPct;
    includedLabel = "Included usage";
  } else {
    includedPercentUsed = summaryPct ?? periodPct ?? sandPct;
  }

  let onDemandUsedCents: number | null = null;
  if (onDemand && typeof onDemand.used === "number") {
    onDemandUsedCents =
      onDemand.used < 500 && !Number.isInteger(onDemand.used)
        ? Math.round(onDemand.used * 100)
        : Math.round(onDemand.used);
  } else if (summary?.onDemandUsage) {
    const u = summary.onDemandUsage;
    onDemandUsedCents =
      typeof u.usedCents === "number" ? u.usedCents : Math.round(num(u.used) * 100);
  }

  const sandPool =
    sand && (typeof sand.limit === "number" || typeof sand.used === "number")
      ? {
          used: num(sand.used),
          limit: num(sand.limit),
          remaining: num(sand.remaining ?? num(sand.limit) - num(sand.used)),
          resetAt:
            typeof sand.nextResetTimestampUtc === "string"
              ? sand.nextResetTimestampUtc
              : typeof sand.resetAt === "string"
                ? sand.resetAt
                : undefined,
        }
      : undefined;

  const planName =
    (typeof sand?.cursorPlanName === "string" && sand.cursorPlanName) ||
    summary?.membershipType ||
    me?.membershipType ||
    me?.subscriptionStatus ||
    "unknown";

  const weeklyStart = toIsoMaybe(sand?.currentPeriodStart);
  const weeklyEnd = toIsoMaybe(sand?.nextResetTimestampUtc);
  const monthStart = toIsoMaybe(summary?.billingCycleStart) ?? toIsoMaybe(period?.billingCycleStart);
  const monthEnd = toIsoMaybe(summary?.billingCycleEnd) ?? toIsoMaybe(period?.billingCycleEnd);

  return {
    membershipType: planName,
    email: me?.email,
    // Show weekly window when sand drives the ring (matches Overview).
    cycleStart: weeklyStart ?? monthStart,
    cycleEnd: weeklyEnd ?? monthEnd,
    nextReset: weeklyEnd ?? toIsoMaybe(summary?.nextResetDate as string | undefined) ?? monthEnd,
    includedPercentUsed,
    includedUsed,
    includedLimit,
    includedLabel,
    onDemandUsedCents: onDemandUsedCents ?? 0,
    onDemandEnabled: onDemand?.enabled === true,
    onDemandLimitCents:
      onDemand?.limit == null ? null : Math.round(num(onDemand.limit) * 100),
    displayMessage:
      (typeof period?.displayMessage === "string" ? period.displayMessage : undefined) ||
      (typeof summary?.autoModelSelectedDisplayMessage === "string"
        ? (summary.autoModelSelectedDisplayMessage as string)
        : undefined),
    sandPool,
  };
}

function resolveModelNames(row: {
  modelIntent?: string;
  model?: string;
}): { modelIntent: string; model: string } {
  const intentRaw = row.modelIntent != null ? String(row.modelIntent).trim() : "";
  const actualRaw = row.model != null ? String(row.model).trim() : "";
  const modelIntent = intentRaw || actualRaw || "unknown";
  const model = actualRaw || intentRaw || "unknown";
  return { modelIntent, model };
}

function modelRowKey(modelIntent: string, model: string): string {
  return `${modelIntent}\0${model}`;
}

function emptyModelRow(modelIntent: string, model: string): ModelBreakdown {
  return {
    modelIntent,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costCents: 0,
  };
}

export function modelsFromAggregated(
  agg: AggregatedUsageEventsResponse | undefined
): ModelBreakdown[] {
  const list = agg?.aggregations ?? [];
  const map = new Map<string, ModelBreakdown>();
  for (const row of list) {
    const { modelIntent, model } = resolveModelNames(row);
    const key = modelRowKey(modelIntent, model);
    let dest = map.get(key);
    if (!dest) {
      dest = emptyModelRow(modelIntent, model);
      map.set(key, dest);
    }
    dest.inputTokens += num(row.inputTokens);
    dest.outputTokens += num(row.outputTokens);
    dest.cacheReadTokens += num(row.cacheReadTokens);
    dest.cacheWriteTokens += num(row.cacheWriteTokens);
    dest.costCents += num(row.totalCents ?? row.costCents);
  }
  const models = [...map.values()].map((m) => ({
    ...m,
    totalTokens:
      m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens,
  }));
  models.sort((a, b) => b.costCents - a.costCents || b.totalTokens - a.totalTokens);
  return models;
}

export function modelsFromEvents(events: FilteredUsageEvent[]): ModelBreakdown[] {
  const map = new Map<string, ModelBreakdown>();
  for (const ev of events) {
    const { modelIntent, model } = resolveModelNames(ev);
    const key = modelRowKey(modelIntent, model);
    let row = map.get(key);
    if (!row) {
      row = emptyModelRow(modelIntent, model);
      map.set(key, row);
    }
    const t = ev.tokenUsage;
    row.inputTokens += num(t?.inputTokens);
    row.outputTokens += num(t?.outputTokens);
    row.cacheReadTokens += num(t?.cacheReadTokens);
    row.cacheWriteTokens += num(t?.cacheWriteTokens);
    row.costCents += eventCostCents(ev);
  }
  for (const row of map.values()) {
    row.totalTokens =
      row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens;
  }
  return [...map.values()].sort(
    (a, b) => b.costCents - a.costCents || b.totalTokens - a.totalTokens
  );
}

/**
 * API model rows are authoritative for tokens/cost. Local tracking fills in
 * provisional rows for chats whose conversationId is not yet in the API —
 * those drop away automatically once Cursor publishes matching events.
 */
export function mergeModelsWithLocal(input: {
  apiModels: ModelBreakdown[];
  events: FilteredUsageEvent[];
  localConversations: LocalConversationActivity[];
  localModels: LocalModelActivity[];
  rangeStartMs: number;
  rangeEndMs: number;
}): ModelBreakdown[] {
  const matchedIds = apiConversationIds(input.events);
  const modelByConversation = new Map<string, string>();
  for (const local of input.localModels) {
    modelByConversation.set(local.conversationId, local.model);
  }

  const estimatedByConversation = new Map<string, number>();
  for (const local of input.localConversations) {
    estimatedByConversation.set(
      local.conversationId,
      Math.max(0, local.estimatedTokens || 0)
    );
  }

  const pendingByLabel = new Map<
    string,
    { ids: Set<string>; estimatedTokens: number }
  >();
  const addPending = (label: string, conversationId: string) => {
    let entry = pendingByLabel.get(label);
    if (!entry) {
      entry = { ids: new Set(), estimatedTokens: 0 };
      pendingByLabel.set(label, entry);
    }
    if (entry.ids.has(conversationId)) {
      return;
    }
    entry.ids.add(conversationId);
    entry.estimatedTokens += estimatedByConversation.get(conversationId) ?? 0;
  };

  for (const local of input.localConversations) {
    if (matchedIds.has(local.conversationId)) {
      continue;
    }
    if (
      local.lastActiveMs < input.rangeStartMs ||
      local.lastActiveMs > input.rangeEndMs
    ) {
      continue;
    }
    const raw = modelByConversation.get(local.conversationId) ?? "unknown";
    addPending(formatLocalModelLabel(raw), local.conversationId);
  }

  // Also surface model hints from tracking for chats that produced code but
  // were not picked up by the transcript scan (rare).
  for (const local of input.localModels) {
    if (matchedIds.has(local.conversationId)) {
      continue;
    }
    if (
      local.lastActiveMs < input.rangeStartMs ||
      local.lastActiveMs > input.rangeEndMs
    ) {
      continue;
    }
    addPending(formatLocalModelLabel(local.model), local.conversationId);
  }

  const apiRows = input.apiModels.map((m) => ({
    ...m,
    localPending: false as boolean | undefined,
    pendingConversations: undefined as number | undefined,
    tokensEstimated: false as boolean | undefined,
  }));

  const provisional: ModelBreakdown[] = [...pendingByLabel.entries()].map(
    ([label, entry]) => ({
      modelIntent: label,
      model: label,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: entry.estimatedTokens,
      costCents: 0,
      localPending: true,
      pendingConversations: entry.ids.size,
      tokensEstimated: entry.estimatedTokens > 0,
    })
  );
  provisional.sort(
    (a, b) =>
      b.totalTokens - a.totalTokens ||
      (b.pendingConversations ?? 0) - (a.pendingConversations ?? 0) ||
      a.modelIntent.localeCompare(b.modelIntent)
  );

  return [...apiRows, ...provisional];
}

function emptyDailyPoint(date: string): DailyPoint {
  return {
    date,
    tokens: 0,
    costCents: 0,
    eventCount: 0,
    localPendingConversations: 0,
    localEstimatedTokens: 0,
    matchedConversations: 0,
  };
}

/**
 * Build daily Trend points: API tokens are authoritative; local chats whose
 * conversationId is not yet in the API contribute pending counts plus a
 * rough transcript-based token estimate (chars÷4).
 */
export function dailyFromEvents(
  events: FilteredUsageEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
  localConversations: LocalConversationActivity[] = []
): DailyPoint[] {
  const byDay = new Map<string, DailyPoint>();
  for (const key of eachLocalDayKeys(rangeStartMs, rangeEndMs)) {
    byDay.set(key, emptyDailyPoint(key));
  }

  const matchedIds = apiConversationIds(events);
  const matchedPerDay = new Map<string, Set<string>>();

  for (const ev of events) {
    const ms = asDateMs(ev.timestamp);
    if (ms === undefined) {
      continue;
    }
    const key = dayKeyLocal(ms);
    let point = byDay.get(key);
    if (!point) {
      point = emptyDailyPoint(key);
      byDay.set(key, point);
    }
    point.tokens += eventTokens(ev);
    point.costCents += eventCostCents(ev);
    point.eventCount += 1;
    const cid = extractConversationId(ev);
    if (cid) {
      let set = matchedPerDay.get(key);
      if (!set) {
        set = new Set();
        matchedPerDay.set(key, set);
      }
      set.add(cid);
    }
  }

  for (const [key, set] of matchedPerDay) {
    const point = byDay.get(key);
    if (point) {
      point.matchedConversations = set.size;
    }
  }

  const pendingPerDay = new Map<
    string,
    { ids: Set<string>; estimatedTokens: number }
  >();
  for (const local of localConversations) {
    if (matchedIds.has(local.conversationId)) {
      continue;
    }
    if (local.lastActiveMs < rangeStartMs || local.lastActiveMs > rangeEndMs) {
      continue;
    }
    const key = local.dayKey;
    let entry = pendingPerDay.get(key);
    if (!entry) {
      entry = { ids: new Set(), estimatedTokens: 0 };
      pendingPerDay.set(key, entry);
    }
    if (entry.ids.has(local.conversationId)) {
      continue;
    }
    entry.ids.add(local.conversationId);
    entry.estimatedTokens += Math.max(0, local.estimatedTokens || 0);
  }

  for (const [key, entry] of pendingPerDay) {
    let point = byDay.get(key);
    if (!point) {
      point = emptyDailyPoint(key);
      byDay.set(key, point);
    }
    point.localPendingConversations = entry.ids.size;
    point.localEstimatedTokens = entry.estimatedTokens;
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildTrendMeta(input: {
  events: FilteredUsageEvent[];
  localConversations: LocalConversationActivity[];
  daily: DailyPoint[];
  rangeKind: TrendRangeKind;
  includedPercentUsed: number | null;
  rangeStartMs: number;
}): TrendMeta {
  const matchedIds = apiConversationIds(input.events);
  let lastEventMs: number | undefined;
  for (const ev of input.events) {
    const ms = asDateMs(ev.timestamp);
    if (ms === undefined) {
      continue;
    }
    if (lastEventMs === undefined || ms > lastEventMs) {
      lastEventMs = ms;
    }
  }

  const pending = input.localConversations.filter(
    (c) =>
      !matchedIds.has(c.conversationId) &&
      c.lastActiveMs >= input.rangeStartMs
  );
  let lastLocalMs: number | undefined;
  for (const c of input.localConversations) {
    if (lastLocalMs === undefined || c.lastActiveMs > lastLocalMs) {
      lastLocalMs = c.lastActiveMs;
    }
  }

  const pendingConversations = pending.length;
  const matchedConversations = matchedIds.size;
  const hasApiTokens = input.daily.some((d) => d.tokens > 0);
  const planSuggestsUsage =
    input.includedPercentUsed != null && input.includedPercentUsed > 0.5;
  const eventsStale =
    pendingConversations > 0 ||
    (planSuggestsUsage && !hasApiTokens) ||
    (lastEventMs !== undefined &&
      pendingConversations > 0 &&
      Date.now() - lastEventMs > 30 * 60_000);

  const parts: string[] = [];
  parts.push(
    input.rangeKind === "weekly" ? "Weekly window" : "Billing cycle window"
  );
  parts.push(`${input.daily.length} days`);
  if (lastEventMs !== undefined) {
    parts.push(`last API event ${formatShortWhen(lastEventMs)}`);
  } else {
    parts.push("no API token events yet");
  }
  if (pendingConversations > 0) {
    parts.push(
      `${pendingConversations} local chat${pendingConversations === 1 ? "" : "s"} pending API`
    );
  }
  if (matchedConversations > 0) {
    parts.push(`${matchedConversations} matched`);
  }

  return {
    rangeKind: input.rangeKind,
    lastEventAt:
      lastEventMs !== undefined
        ? new Date(lastEventMs).toISOString()
        : undefined,
    lastLocalAt:
      lastLocalMs !== undefined
        ? new Date(lastLocalMs).toISOString()
        : undefined,
    pendingConversations,
    matchedConversations,
    eventsStale,
    note: parts.join(" · "),
  };
}

function formatShortWhen(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function totalsFromModels(models: ModelBreakdown[]): DashboardData["totals"] {
  return models.reduce(
    (acc, m) => {
      acc.inputTokens += m.inputTokens;
      acc.outputTokens += m.outputTokens;
      acc.cacheReadTokens += m.cacheReadTokens;
      acc.cacheWriteTokens += m.cacheWriteTokens;
      acc.costCents += m.costCents;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costCents: 0,
    }
  );
}

export function snapshotFromEvents(events: FilteredUsageEvent[]): {
  totalTokens: number;
  costCents: number;
  eventCount: number;
} {
  let totalTokens = 0;
  let costCents = 0;
  for (const ev of events) {
    totalTokens += eventTokens(ev);
    costCents += eventCostCents(ev);
  }
  return { totalTokens, costCents, eventCount: events.length };
}

export function buildDashboardData(input: {
  summary?: UsageSummary;
  me?: AuthMe;
  aggregated?: AggregatedUsageEventsResponse;
  filtered?: FilteredUsageEventsResponse;
  sand?: SandUsageStatus | null;
  period?: PeriodUsage | null;
  rangeStartMs: number;
  rangeEndMs: number;
  rangeKind: TrendRangeKind;
  localConversations?: LocalConversationActivity[];
  localModels?: LocalModelActivity[];
  workspaces: WorkspaceStat[];
  contextUsage: ContextUsageView;
  error?: string;
  authError?: boolean;
}): DashboardData {
  const events = input.filtered?.usageEventsDisplay ?? [];
  const localConversations = input.localConversations ?? [];
  const localModels = input.localModels ?? [];
  // Prefer per-event rows when available so intent vs actual model both surface.
  const apiModels =
    events.length > 0
      ? modelsFromEvents(events)
      : modelsFromAggregated(input.aggregated);
  const models = mergeModelsWithLocal({
    apiModels,
    events,
    localConversations,
    localModels,
    rangeStartMs: input.rangeStartMs,
    rangeEndMs: input.rangeEndMs,
  });
  // Only trust aggregated totals when they cover the same window we display.
  // For weekly windows with lagging events, prefer summing the (possibly empty)
  // event/model rows rather than monthly aggregates. Provisional local rows
  // may show estimated tokens in the UI but are excluded from plan totals.
  const useAggregatedTotals =
    input.rangeKind === "monthly" &&
    !!input.aggregated &&
    (input.aggregated.totalInputTokens !== undefined ||
      input.aggregated.totalCostCents !== undefined);
  const totals = useAggregatedTotals
    ? {
        inputTokens: num(input.aggregated!.totalInputTokens),
        outputTokens: num(input.aggregated!.totalOutputTokens),
        cacheReadTokens: num(input.aggregated!.totalCacheReadTokens),
        cacheWriteTokens: num(input.aggregated!.totalCacheWriteTokens),
        costCents: num(input.aggregated!.totalCostCents),
      }
    : totalsFromModels(apiModels);

  const plan = buildPlanView(input.summary, input.me, input.sand, input.period);
  const daily = dailyFromEvents(
    events,
    input.rangeStartMs,
    input.rangeEndMs,
    localConversations
  );
  const trend = buildTrendMeta({
    events,
    localConversations,
    daily,
    rangeKind: input.rangeKind,
    includedPercentUsed: plan.includedPercentUsed,
    rangeStartMs: input.rangeStartMs,
  });

  return {
    fetchedAt: new Date().toISOString(),
    plan,
    models,
    daily,
    trend,
    workspaces: input.workspaces,
    contextUsage: input.contextUsage,
    totals,
    error: input.error,
    authError: input.authError,
  };
}

/**
 * Prefer the weekly sand/included window when that drives the plan ring,
 * so Trend/models match what "included %" is measuring.
 */
export function resolveCycleRange(
  summary: UsageSummary | undefined,
  period: PeriodUsage | null | undefined,
  sand?: SandUsageStatus | null,
  fallbackDays = 30
): { startMs: number; endMs: number; rangeKind: TrendRangeKind } {
  const endMs = Date.now();

  const weeklyStart = asDateMs(sand?.currentPeriodStart);
  if (weeklyStart !== undefined) {
    const weeklyEnd = asDateMs(sand?.nextResetTimestampUtc);
    return {
      startMs: weeklyStart,
      endMs: weeklyEnd !== undefined ? Math.min(weeklyEnd, endMs) : endMs,
      rangeKind: "weekly",
    };
  }

  const startParsed =
    asDateMs(summary?.billingCycleStart) ?? asDateMs(period?.billingCycleStart);
  const endParsed =
    asDateMs(summary?.billingCycleEnd) ?? asDateMs(period?.billingCycleEnd);
  if (startParsed !== undefined) {
    return {
      startMs: startParsed,
      endMs: endParsed !== undefined ? Math.min(endParsed, endMs) : endMs,
      rangeKind: "monthly",
    };
  }
  return {
    startMs: endMs - fallbackDays * 86400000,
    endMs,
    rangeKind: "monthly",
  };
}
