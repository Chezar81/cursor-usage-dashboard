import { dayKeyLocal, eachLocalDayKeys } from "./dates";
import {
  modelsGroupedByRoutedFromAggregated,
  modelsGroupedByRoutedModel,
} from "./modelRouting";
import type { LocalConversationActivity } from "./localActivity";
import { apiConversationIds, extractConversationId } from "./localActivity";
import {
  formatLocalModelLabel,
  type LocalModelActivity,
} from "./localModelActivity";
import { isAutoModelIntent } from "./modelRouting";
import type {
  AggregatedUsageEventsResponse,
  AuthMe,
  ContextUsageView,
  DailyPoint,
  DashboardData,
  DaySession,
  FilteredUsageEvent,
  FilteredUsageEventsResponse,
  ModelBreakdown,
  PeriodUsage,
  PlanView,
  SandUsageStatus,
  TrendMeta,
  TrendRangeKind,
  UsageSummary,
  UserAnalyticsDay,
  UserAnalyticsResponse,
  UserPrepaidBilling,
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

/**
 * Keep only events whose timestamp falls in the dashboard window (inclusive).
 * Rows without a parseable timestamp are dropped — they cannot be placed on the
 * Trend axis and would only distort totals.
 */
export function filterEventsToRange(
  events: FilteredUsageEvent[],
  startMs: number,
  endMs: number
): FilteredUsageEvent[] {
  return events.filter((ev) => {
    const ms = asDateMs(ev.timestamp);
    if (ms === undefined) {
      return false;
    }
    return ms >= startMs && ms <= endMs;
  });
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

/** Parse Connect-RPC int64 that may arrive as number or string. */
function centsField(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.round(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

/** Map get-user-prepaid-billing to the grok.com “Credits available” figures. */
export function resolvePrepaidCredits(
  prepaid: UserPrepaidBilling | null | undefined
): {
  availableCents: number | null;
  totalCents: number | null;
  spentThisMonthCents: number | null;
  prepaidBilling: boolean;
} {
  if (!prepaid || prepaid.eligible !== true) {
    return {
      availableCents: null,
      totalCents: null,
      spentThisMonthCents: null,
      prepaidBilling: false,
    };
  }
  return {
    availableCents: centsField(prepaid.availableCents),
    totalCents: centsField(prepaid.fundedCents),
    spentThisMonthCents: centsField(prepaid.spentThisMonthCents),
    prepaidBilling: true,
  };
}

export function buildPlanView(
  summary: UsageSummary | undefined,
  me: AuthMe | undefined,
  sand: SandUsageStatus | null | undefined,
  period: PeriodUsage | null | undefined,
  prepaid?: UserPrepaidBilling | null
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
  const credits = resolvePrepaidCredits(prepaid);
  // On prepaid (Grok/X) plans, “used this month” is prepaid spend — same as grok.com.
  const balanceUsedCents =
    credits.prepaidBilling && credits.spentThisMonthCents != null
      ? credits.spentThisMonthCents
      : onDemandUsedCents ?? 0;

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
    onDemandUsedCents: balanceUsedCents,
    onDemandEnabled: onDemand?.enabled === true,
    onDemandLimitCents:
      onDemand?.limit == null ? null : Math.round(num(onDemand.limit) * 100),
    creditsAvailableCents: credits.availableCents,
    creditsTotalCents: credits.totalCents,
    prepaidBilling: credits.prepaidBilling,
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

/** Billed token/cost rows beat estimates when deciding which side is primary. */
function modelHasBilledUsage(m: ModelBreakdown): boolean {
  return (
    !m.tokensEstimated &&
    (m.totalTokens > 0 ||
      m.costCents > 0 ||
      (m.inputTokens || 0) > 0 ||
      (m.outputTokens || 0) > 0)
  );
}

/**
 * Consolidated request signal across the three layers:
 * local transcript turns, Cursor analytics, billed usage events.
 */
export function modelEffectiveRequests(m: ModelBreakdown): number {
  return Math.max(
    m.localEstimatedRequests ?? 0,
    m.analyticsRequests ?? 0,
    (m.autoRequests ?? 0) + (m.manualRequests ?? 0)
  );
}

/**
 * localPending when local is the freshest request signal (or the only one).
 * Cleared once analytics catches up or billed events arrive.
 */
function applyModelFreshnessFlags(models: ModelBreakdown[]): ModelBreakdown[] {
  return models.map((m) => {
    if (modelHasBilledUsage(m)) {
      return { ...m, localPending: false };
    }
    const local = m.localEstimatedRequests ?? 0;
    const analytics = m.analyticsRequests ?? 0;
    const localLed =
      local > analytics ||
      (analytics === 0 &&
        (local > 0 ||
          (m.pendingConversations ?? 0) > 0 ||
          !!m.tokensEstimated));
    return { ...m, localPending: localLed };
  });
}

/**
 * Fold local transcript activity into API/analytics model rows.
 * Unmatched chats contribute request + token estimates; matching labels stay
 * one row. Ranking freshness is decided later by applyModelFreshnessFlags.
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

  const rangeDayKeys = new Set(
    eachLocalDayKeys(input.rangeStartMs, input.rangeEndMs)
  );

  const pendingByLabel = new Map<
    string,
    { ids: Set<string>; estimatedTokens: number; estimatedRequests: number }
  >();
  const ensurePending = (label: string) => {
    let entry = pendingByLabel.get(label);
    if (!entry) {
      entry = { ids: new Set(), estimatedTokens: 0, estimatedRequests: 0 };
      pendingByLabel.set(label, entry);
    }
    return entry;
  };

  for (const local of input.localConversations) {
    if (matchedIds.has(local.conversationId)) {
      continue;
    }
    const reqByDay =
      local.estimatedRequestsByDay &&
      Object.keys(local.estimatedRequestsByDay).length > 0
        ? local.estimatedRequestsByDay
        : { [local.dayKey]: local.estimatedRequests || 0 };
    const tokByDay =
      local.estimatedTokensByDay &&
      Object.keys(local.estimatedTokensByDay).length > 0
        ? local.estimatedTokensByDay
        : { [local.dayKey]: local.estimatedTokens || 0 };

    let reqs = 0;
    let toks = 0;
    for (const [key, n] of Object.entries(reqByDay)) {
      if (rangeDayKeys.has(key)) {
        reqs += Math.max(0, n || 0);
      }
    }
    for (const [key, n] of Object.entries(tokByDay)) {
      if (rangeDayKeys.has(key)) {
        toks += Math.max(0, n || 0);
      }
    }
    if (reqs <= 0 && toks <= 0) {
      if (
        local.lastActiveMs < input.rangeStartMs ||
        local.lastActiveMs > input.rangeEndMs
      ) {
        continue;
      }
      reqs = Math.max(0, local.estimatedRequests || 0);
      toks = Math.max(0, local.estimatedTokens || 0);
    }

    const raw = modelByConversation.get(local.conversationId) ?? "unknown";
    const entry = ensurePending(formatLocalModelLabel(raw));
    entry.ids.add(local.conversationId);
    entry.estimatedRequests += reqs;
    entry.estimatedTokens += toks;
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
    const entry = ensurePending(formatLocalModelLabel(local.model));
    entry.ids.add(local.conversationId);
  }

  const apiRows = input.apiModels.map((m) => ({
    ...m,
    localPending: false as boolean | undefined,
    pendingConversations: m.pendingConversations,
    tokensEstimated: m.tokensEstimated,
    localEstimatedRequests: m.localEstimatedRequests,
  }));

  const apiByLabel = new Map<string, ModelBreakdown>();
  for (const row of apiRows) {
    const label = formatLocalModelLabel(row.model || row.modelIntent);
    if (!apiByLabel.has(label)) {
      apiByLabel.set(label, row);
    }
  }

  const provisional: ModelBreakdown[] = [];
  for (const [label, entry] of pendingByLabel) {
    if (
      entry.ids.size === 0 &&
      entry.estimatedRequests <= 0 &&
      entry.estimatedTokens <= 0
    ) {
      continue;
    }
    const existing = apiByLabel.get(label);
    if (existing) {
      // One row: remote layers primary fields, local fills requests/tokens.
      existing.pendingConversations = entry.ids.size;
      existing.localEstimatedRequests = entry.estimatedRequests;
      const hasBilled = modelHasBilledUsage(existing);
      if (!hasBilled && entry.estimatedTokens > 0) {
        existing.totalTokens = entry.estimatedTokens;
        existing.tokensEstimated = true;
      }
      continue;
    }
    provisional.push({
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
      localEstimatedRequests: entry.estimatedRequests,
    });
  }
  provisional.sort(
    (a, b) =>
      modelEffectiveRequests(b) - modelEffectiveRequests(a) ||
      b.totalTokens - a.totalTokens ||
      (b.pendingConversations ?? 0) - (a.pendingConversations ?? 0) ||
      a.modelIntent.localeCompare(b.modelIntent)
  );

  return applyModelFreshnessFlags(
    dedupeModelsByLabel([...apiRows, ...provisional])
  );
}

/**
 * One row per display label. Remote (API/analytics) fields win as the base;
 * local estimates and chat counts fold in. Safety net so a label never
 * appears twice.
 */
export function dedupeModelsByLabel(models: ModelBreakdown[]): ModelBreakdown[] {
  const byLabel = new Map<string, ModelBreakdown>();
  for (const row of models) {
    const label = formatLocalModelLabel(row.model || row.modelIntent);
    const prev = byLabel.get(label);
    if (!prev) {
      byLabel.set(label, { ...row, model: label, modelIntent: label });
      continue;
    }
    const apiFirst = !row.localPending
      ? row
      : !prev.localPending
        ? prev
        : row;
    const other = apiFirst === row ? prev : row;
    const apiHasBilled = modelHasBilledUsage(apiFirst);
    const estTokens = Math.max(
      apiFirst.tokensEstimated ? apiFirst.totalTokens : 0,
      other.tokensEstimated ? other.totalTokens : 0,
      !apiHasBilled ? Math.max(apiFirst.totalTokens, other.totalTokens) : 0
    );
    byLabel.set(label, {
      ...apiFirst,
      model: label,
      modelIntent: label,
      localPending: false,
      analyticsRequests:
        Math.max(apiFirst.analyticsRequests ?? 0, other.analyticsRequests ?? 0) ||
        undefined,
      localEstimatedRequests:
        Math.max(
          apiFirst.localEstimatedRequests ?? 0,
          other.localEstimatedRequests ?? 0
        ) || undefined,
      autoRequests: Math.max(apiFirst.autoRequests ?? 0, other.autoRequests ?? 0) || undefined,
      manualRequests:
        Math.max(apiFirst.manualRequests ?? 0, other.manualRequests ?? 0) ||
        undefined,
      pendingConversations:
        Math.max(
          apiFirst.pendingConversations ?? 0,
          other.pendingConversations ?? 0
        ) || undefined,
      totalTokens: apiHasBilled ? apiFirst.totalTokens : estTokens,
      tokensEstimated: apiHasBilled ? false : estTokens > 0,
    });
  }
  return [...byLabel.values()];
}

function emptyDailyPoint(date: string): DailyPoint {
  return {
    date,
    tokens: 0,
    costCents: 0,
    eventCount: 0,
    localPendingConversations: 0,
    localEstimatedTokens: 0,
    localEstimatedRequests: 0,
    matchedConversations: 0,
    apiRequests: 0,
    includedRequests: 0,
    usageBasedRequests: 0,
    codingActivity: 0,
  };
}

/** Intersection of two inclusive millisecond ranges; null if disjoint. */
export function intersectMsRanges(
  a0: number,
  a1: number,
  b0: number,
  b1: number
): { startMs: number; endMs: number } | null {
  const startMs = Math.max(a0, b0);
  const endMs = Math.min(a1, b1);
  if (startMs > endMs) {
    return null;
  }
  return { startMs, endMs };
}

/**
 * Bounds from get-user-analytics `period` when Cursor sends startDate/endDate.
 */
export function boundsFromUserAnalyticsPeriod(
  analytics: UserAnalyticsResponse | null | undefined
): { startMs: number; endMs: number } | null {
  const p = analytics?.period;
  if (!p || typeof p !== "object") {
    return null;
  }
  const raw = p as { startDate?: string | number; endDate?: string | number };
  const startMs = asDateMs(raw.startDate);
  const endMs = asDateMs(raw.endDate);
  if (startMs === undefined || endMs === undefined) {
    return null;
  }
  return { startMs, endMs };
}

function codingActivityScore(day: UserAnalyticsDay): number {
  return (
    num(day.linesAdded) +
    num(day.linesDeleted) +
    num(day.totalApplies) +
    num(day.totalAccepts)
  );
}

/**
 * Days from get-user-analytics that fall inside the dashboard window.
 * Analytics dates are UTC midnights; dayKeyLocal matches the Trend axis.
 */
export function analyticsDaysInRange(
  analytics: UserAnalyticsResponse | null | undefined,
  rangeStartMs: number,
  rangeEndMs: number
): UserAnalyticsDay[] {
  const rows = analytics?.dailyMetrics ?? [];
  const out: UserAnalyticsDay[] = [];
  for (const day of rows) {
    const ms = asDateMs(day.date);
    if (ms === undefined) {
      continue;
    }
    // Include the UTC day if it overlaps the chart window at all.
    const dayEnd = ms + 86400000 - 1;
    if (dayEnd < rangeStartMs || ms > rangeEndMs) {
      continue;
    }
    out.push(day);
  }
  return out;
}

/** Overlay analytics request counts onto daily Trend points. */
export function mergeDailyWithAnalytics(
  daily: DailyPoint[],
  analyticsDays: UserAnalyticsDay[]
): DailyPoint[] {
  if (!analyticsDays.length) {
    return daily;
  }
  const byDay = new Map(daily.map((d) => [d.date, { ...d }]));
  for (const day of analyticsDays) {
    const ms = asDateMs(day.date);
    if (ms === undefined) {
      continue;
    }
    const key = dayKeyLocal(ms);
    let point = byDay.get(key);
    if (!point) {
      point = emptyDailyPoint(key);
      byDay.set(key, point);
    }
    point.apiRequests = num(day.agentRequests);
    point.includedRequests = num(day.subscriptionIncludedReqs);
    point.usageBasedRequests = num(day.usageBasedReqs);
    const linesAdded = num(day.linesAdded);
    const linesDeleted = num(day.linesDeleted);
    const applies = num(day.totalApplies);
    const accepts = num(day.totalAccepts);
    if (linesAdded > 0) {
      point.linesAdded = linesAdded;
    }
    if (linesDeleted > 0) {
      point.linesDeleted = linesDeleted;
    }
    if (applies > 0) {
      point.totalApplies = applies;
    }
    if (accepts > 0) {
      point.totalAccepts = accepts;
    }
    const coding = codingActivityScore(day);
    if (coding > 0) {
      point.codingActivity = coding;
    }
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Aggregate analytics modelUsage into ModelBreakdown request rows.
 * Used when billed token events are empty (unified Grok billing).
 */
export function modelsFromAnalytics(
  analyticsDays: UserAnalyticsDay[]
): ModelBreakdown[] {
  const byModel = new Map<string, ModelBreakdown>();
  for (const day of analyticsDays) {
    for (const row of day.modelUsage ?? []) {
      const raw = typeof row.name === "string" ? row.name.trim() : "";
      if (!raw) {
        continue;
      }
      const label = formatLocalModelLabel(raw);
      const count = Math.max(0, num(row.count));
      if (count <= 0) {
        continue;
      }
      let entry = byModel.get(label);
      if (!entry) {
        entry = {
          modelIntent: label,
          model: label,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          costCents: 0,
          analyticsRequests: 0,
          autoRequests: 0,
          manualRequests: 0,
        };
        byModel.set(label, entry);
      }
      entry.analyticsRequests = (entry.analyticsRequests ?? 0) + count;
      if (isAutoModelIntent(raw)) {
        entry.autoRequests = (entry.autoRequests ?? 0) + count;
      } else {
        entry.manualRequests = (entry.manualRequests ?? 0) + count;
      }
    }
  }
  return [...byModel.values()].sort(
    (a, b) =>
      (b.analyticsRequests ?? 0) - (a.analyticsRequests ?? 0) ||
      a.model.localeCompare(b.model)
  );
}

/**
 * Three-layer model consolidation (freshest → authoritative):
 * 1. Local transcript estimates (always available on this machine)
 * 2. Cursor analytics request counts, folded onto matching labels
 * 3. Billed usage-API events/aggregates when they publish tokens or cost
 *
 * Ranking uses billed cost/tokens when present; otherwise the max of local
 * and analytics request counts so a lagging analytics feed cannot freeze Top 5.
 */
export function mergeModelsWithAnalytics(input: {
  apiModels: ModelBreakdown[];
  analyticsModels: ModelBreakdown[];
  events: FilteredUsageEvent[];
  localConversations: LocalConversationActivity[];
  localModels: LocalModelActivity[];
  rangeStartMs: number;
  rangeEndMs: number;
}): ModelBreakdown[] {
  const apiHasBilled = input.apiModels.some((m) => modelHasBilledUsage(m));

  // Layer 2+3 base: billed rows when present, else analytics. Local (layer 1)
  // always folds in via mergeModelsWithLocal — including when both remotes are empty.
  const remoteByLabel = new Map<string, ModelBreakdown>();
  for (const row of apiHasBilled ? input.apiModels : input.analyticsModels) {
    const label = formatLocalModelLabel(row.model || row.modelIntent);
    if (!remoteByLabel.has(label)) {
      remoteByLabel.set(label, { ...row, model: label, modelIntent: label });
    }
  }

  if (apiHasBilled) {
    // Overlay analytics request counts without wiping billed token/cost fields.
    for (const row of input.analyticsModels) {
      const label = formatLocalModelLabel(row.model || row.modelIntent);
      const existing = remoteByLabel.get(label);
      if (existing) {
        existing.analyticsRequests =
          Math.max(
            existing.analyticsRequests ?? 0,
            row.analyticsRequests ?? 0
          ) || undefined;
        existing.autoRequests =
          Math.max(existing.autoRequests ?? 0, row.autoRequests ?? 0) ||
          undefined;
        existing.manualRequests =
          Math.max(existing.manualRequests ?? 0, row.manualRequests ?? 0) ||
          undefined;
      } else {
        remoteByLabel.set(label, { ...row, model: label, modelIntent: label });
      }
    }
  }

  const merged = mergeModelsWithLocal({
    apiModels: [...remoteByLabel.values()],
    events: input.events,
    localConversations: input.localConversations,
    localModels: input.localModels,
    rangeStartMs: input.rangeStartMs,
    rangeEndMs: input.rangeEndMs,
  });

  merged.sort((a, b) => {
    if (apiHasBilled) {
      return (
        b.costCents - a.costCents ||
        b.totalTokens - a.totalTokens ||
        modelEffectiveRequests(b) - modelEffectiveRequests(a) ||
        a.model.localeCompare(b.model)
      );
    }
    return (
      modelEffectiveRequests(b) - modelEffectiveRequests(a) ||
      b.totalTokens - a.totalTokens ||
      a.model.localeCompare(b.model)
    );
  });
  return merged;
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
    { ids: Set<string>; estimatedTokens: number; estimatedRequests: number }
  >();
  const ensurePending = (key: string) => {
    let entry = pendingPerDay.get(key);
    if (!entry) {
      entry = { ids: new Set(), estimatedTokens: 0, estimatedRequests: 0 };
      pendingPerDay.set(key, entry);
    }
    return entry;
  };
  const rangeDayKeys = new Set(eachLocalDayKeys(rangeStartMs, rangeEndMs));

  for (const local of localConversations) {
    if (matchedIds.has(local.conversationId)) {
      continue;
    }
    const reqByDay =
      local.estimatedRequestsByDay &&
      Object.keys(local.estimatedRequestsByDay).length > 0
        ? local.estimatedRequestsByDay
        : { [local.dayKey]: local.estimatedRequests || 0 };
    const tokByDay =
      local.estimatedTokensByDay &&
      Object.keys(local.estimatedTokensByDay).length > 0
        ? local.estimatedTokensByDay
        : { [local.dayKey]: local.estimatedTokens || 0 };

    for (const [key, reqs] of Object.entries(reqByDay)) {
      if (!rangeDayKeys.has(key)) {
        continue;
      }
      const entry = ensurePending(key);
      entry.ids.add(local.conversationId);
      entry.estimatedRequests += Math.max(0, reqs || 0);
    }
    for (const [key, toks] of Object.entries(tokByDay)) {
      if (!rangeDayKeys.has(key)) {
        continue;
      }
      const entry = ensurePending(key);
      entry.ids.add(local.conversationId);
      entry.estimatedTokens += Math.max(0, toks || 0);
    }
  }

  for (const [key, entry] of pendingPerDay) {
    let point = byDay.get(key);
    if (!point) {
      point = emptyDailyPoint(key);
      byDay.set(key, point);
    }
    point.localPendingConversations = entry.ids.size;
    point.localEstimatedTokens = entry.estimatedTokens;
    point.localEstimatedRequests = entry.estimatedRequests;
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

interface SessionModelAcc {
  modelIntent: string;
  model: string;
  tokens: number;
  costCents: number;
}

interface SessionBucket {
  date: string;
  conversationId: string;
  title: string;
  workspace: string;
  requests: number;
  tokens: number;
  costCents: number;
  localPending: boolean;
  tokensEstimated: boolean;
  models: Map<string, SessionModelAcc>;
}

/**
 * One row per agent chat per local day.
 * API events supply billed tokens and cost. Chats the API has not listed yet
 * appear on their last-active day with a transcript estimate, same rule as Trend.
 */
export function sessionsFromActivity(input: {
  events: FilteredUsageEvent[];
  localConversations: LocalConversationActivity[];
  localModels: LocalModelActivity[];
  rangeStartMs: number;
  rangeEndMs: number;
}): DaySession[] {
  const meta = new Map<
    string,
    { title: string; workspace: string }
  >();
  for (const local of input.localConversations) {
    meta.set(local.conversationId, {
      title: (local.title || "").trim(),
      workspace: (local.displayName || "").trim(),
    });
  }
  const modelByConversation = new Map<string, string>();
  for (const local of input.localModels) {
    modelByConversation.set(
      local.conversationId,
      formatLocalModelLabel(local.model)
    );
  }

  const buckets = new Map<string, SessionBucket>();
  const ensure = (date: string, conversationId: string): SessionBucket => {
    const key = `${date}\0${conversationId}`;
    const existing = buckets.get(key);
    if (existing) {
      return existing;
    }
    const info = conversationId ? meta.get(conversationId) : undefined;
    const bucket: SessionBucket = {
      date,
      conversationId,
      title: info?.title || (conversationId ? "Untitled chat" : "Other requests"),
      workspace: info?.workspace || "—",
      requests: 0,
      tokens: 0,
      costCents: 0,
      localPending: false,
      tokensEstimated: false,
      models: new Map(),
    };
    buckets.set(key, bucket);
    return bucket;
  };

  const matchedIds = apiConversationIds(input.events);

  for (const ev of input.events) {
    const ms = asDateMs(ev.timestamp);
    if (ms === undefined) {
      continue;
    }
    const bucket = ensure(dayKeyLocal(ms), extractConversationId(ev) || "");
    const tokens = eventTokens(ev);
    const cost = eventCostCents(ev);
    bucket.requests += 1;
    bucket.tokens += tokens;
    bucket.costCents += cost;
    const names = resolveModelNames(ev);
    const mkey = modelRowKey(names.modelIntent, names.model);
    let row = bucket.models.get(mkey);
    if (!row) {
      row = { modelIntent: names.modelIntent, model: names.model, tokens: 0, costCents: 0 };
      bucket.models.set(mkey, row);
    }
    row.tokens += tokens;
    row.costCents += cost;
  }

  const rangeDayKeys = new Set(
    eachLocalDayKeys(input.rangeStartMs, input.rangeEndMs)
  );
  for (const local of input.localConversations) {
    if (matchedIds.has(local.conversationId)) {
      continue;
    }
    const reqByDay =
      local.estimatedRequestsByDay &&
      Object.keys(local.estimatedRequestsByDay).length > 0
        ? local.estimatedRequestsByDay
        : { [local.dayKey]: local.estimatedRequests || 0 };
    const tokByDay =
      local.estimatedTokensByDay &&
      Object.keys(local.estimatedTokensByDay).length > 0
        ? local.estimatedTokensByDay
        : { [local.dayKey]: local.estimatedTokens || 0 };
    const label = modelByConversation.get(local.conversationId) ?? "Unknown";
    const dayKeys = new Set([
      ...Object.keys(reqByDay),
      ...Object.keys(tokByDay),
    ]);
    let any = false;
    for (const dayKey of dayKeys) {
      if (!rangeDayKeys.has(dayKey)) {
        continue;
      }
      const reqs = Math.max(0, reqByDay[dayKey] || 0);
      const toks = Math.max(0, tokByDay[dayKey] || 0);
      if (reqs <= 0 && toks <= 0) {
        continue;
      }
      any = true;
      const bucket = ensure(dayKey, local.conversationId);
      bucket.localPending = true;
      bucket.requests = reqs;
      bucket.tokens = toks;
      bucket.tokensEstimated = toks > 0;
      bucket.models.set(label, {
        modelIntent: label,
        model: label,
        tokens: toks,
        costCents: 0,
      });
    }
    if (
      !any &&
      local.lastActiveMs >= input.rangeStartMs &&
      local.lastActiveMs <= input.rangeEndMs &&
      rangeDayKeys.has(local.dayKey)
    ) {
      const bucket = ensure(local.dayKey, local.conversationId);
      bucket.localPending = true;
      bucket.tokens = Math.max(0, local.estimatedTokens || 0);
      bucket.tokensEstimated = bucket.tokens > 0;
      bucket.requests = Math.max(0, local.estimatedRequests || 0);
      bucket.models.set(label, {
        modelIntent: label,
        model: label,
        tokens: bucket.tokens,
        costCents: 0,
      });
    }
  }

  const sessions: DaySession[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.requests === 0 && !bucket.localPending) {
      continue;
    }
    const dominant = dominantSessionModel(bucket.models);
    const model = dominant?.model || (bucket.localPending ? "Unknown" : "unknown");
    const modelIntent = dominant?.modelIntent;
    const modelCount = bucket.models.size;
    sessions.push({
      date: bucket.date,
      conversationId: bucket.conversationId,
      title: bucket.title,
      workspace: bucket.workspace,
      model,
      modelIntent:
        modelIntent && modelIntent !== model ? modelIntent : undefined,
      modelCount: modelCount > 1 ? modelCount : undefined,
      requests: bucket.requests,
      tokens: bucket.tokens,
      costCents: bucket.costCents,
      localPending: bucket.localPending || undefined,
      tokensEstimated: bucket.tokensEstimated || undefined,
    });
  }

  sessions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      b.costCents - a.costCents ||
      b.tokens - a.tokens ||
      a.title.localeCompare(b.title)
  );
  return sessions;
}

function dominantSessionModel(
  models: Map<string, SessionModelAcc>
): SessionModelAcc | undefined {
  let best: SessionModelAcc | undefined;
  for (const row of models.values()) {
    if (
      !best ||
      row.costCents > best.costCents ||
      (row.costCents === best.costCents && row.tokens > best.tokens)
    ) {
      best = row;
    }
  }
  return best;
}

export function buildTrendMeta(input: {
  events: FilteredUsageEvent[];
  localConversations: LocalConversationActivity[];
  daily: DailyPoint[];
  rangeKind: TrendRangeKind;
  includedPercentUsed: number | null;
  rangeStartMs: number;
  /** Newest event Cursor has published, even if it is outside the chart window. */
  latestKnownEventMs?: number;
  usageEventsFetchStrategy?: TrendMeta["usageEventsFetchStrategy"];
  /** Unified SAND/Grok billing (sand.isUnified) — see TrendMeta.apiEventsUnavailable. */
  unifiedBilling?: boolean;
  analyticsDays?: UserAnalyticsDay[];
  /** Trend chart aligned to get-user-analytics period ∩ billing window. */
  analyticsPeriodApplied?: boolean;
  analyticsPeriodStartMs?: number;
  analyticsPeriodEndMs?: number;
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

  let lastEventBeforeWindow = false;
  if (lastEventMs === undefined && input.latestKnownEventMs !== undefined) {
    lastEventMs = input.latestKnownEventMs;
    lastEventBeforeWindow = input.latestKnownEventMs < input.rangeStartMs;
  }

  // Unified Grok/SAND billing publishes the pool % (get-sand-usage-status /
  // get-current-period-usage) but no per-chat token/cost rows on the legacy
  // event endpoints. A widened analytics Trend axis can place a stale
  // pre-window peek inside the chart span — do not treat that as live events.
  const hasInWindowApiTokensOrSpend = input.daily.some(
    (d) => (d.tokens || 0) > 0 || (d.costCents || 0) > 0
  );
  const apiEventsUnavailable =
    input.unifiedBilling === true &&
    input.events.length === 0 &&
    !hasInWindowApiTokensOrSpend;

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
    parts.push(
      lastEventBeforeWindow
        ? `last API event ${formatShortWhen(lastEventMs)} (before this window)`
        : `last API event ${formatShortWhen(lastEventMs)}`
    );
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
  const analyticsRequests = (input.analyticsDays ?? []).reduce(
    (s, d) => s + num(d.agentRequests),
    0
  );
  const analyticsAvailable =
    (input.analyticsDays?.length ?? 0) > 0 && analyticsRequests > 0;
  const localEstimatedRequests = input.daily.reduce(
    (s, d) => s + (d.localEstimatedRequests || 0),
    0
  );
  // Cursor analytics often lags hours behind local chats on unified billing.
  const analyticsLagging = input.daily.some((d) => {
    const localReqs = d.localEstimatedRequests || 0;
    const apiReqs = d.apiRequests || 0;
    if (localReqs < 3) {
      return false;
    }
    return localReqs >= Math.max(3, apiReqs * 3 + 2);
  });
  const spendTrendUnavailable = apiEventsUnavailable;

  if (apiEventsUnavailable) {
    parts.push(
      analyticsAvailable
        ? "per-chat token events not published for unified billing — request counts sync from Cursor analytics; token figures are local day-bucketed estimates (~); spend trend unavailable"
        : "per-chat API events not published for unified billing — local day-bucketed estimates (~) are primary; spend trend unavailable"
    );
  }
  if (analyticsLagging) {
    parts.push(
      `Cursor analytics lagging local activity (~${localEstimatedRequests} local turns vs ${analyticsRequests} published)`
    );
  } else if (analyticsAvailable) {
    parts.push(
      `${analyticsRequests} analytics request${analyticsRequests === 1 ? "" : "s"}`
    );
  }
  if (input.usageEventsFetchStrategy && input.usageEventsFetchStrategy !== "primary") {
    parts.push(`events loaded via ${input.usageEventsFetchStrategy}`);
  }
  if (
    input.analyticsPeriodApplied &&
    input.analyticsPeriodStartMs !== undefined &&
    input.analyticsPeriodEndMs !== undefined
  ) {
    parts.push(
      `Trend aligned to Cursor analytics period (${formatShortWhen(input.analyticsPeriodStartMs)}–${formatShortWhen(input.analyticsPeriodEndMs)})`
    );
  }
  if (
    input.events.length === 0 &&
    planSuggestsUsage &&
    input.usageEventsFetchStrategy === "empty"
  ) {
    parts.push(
      "detail API returned no rows (pool % uses a different endpoint — model stats stay local until Cursor publishes events)"
    );
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
    apiEventsUnavailable,
    analyticsAvailable,
    analyticsRequests: analyticsAvailable ? analyticsRequests : undefined,
    analyticsLagging: analyticsLagging || undefined,
    preferRequestsMetric: apiEventsUnavailable && analyticsAvailable,
    spendTrendUnavailable: spendTrendUnavailable || undefined,
    lastEventBeforeWindow,
    usageEventsFetchStrategy: input.usageEventsFetchStrategy,
    analyticsPeriodApplied: input.analyticsPeriodApplied || undefined,
    analyticsPeriodStartMs: input.analyticsPeriodStartMs,
    analyticsPeriodEndMs: input.analyticsPeriodEndMs,
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
  prepaid?: UserPrepaidBilling | null;
  analytics?: UserAnalyticsResponse | null;
  rangeStartMs: number;
  rangeEndMs: number;
  rangeKind: TrendRangeKind;
  /** Newest published usage event, used when this window's event list is empty. */
  latestKnownEventMs?: number;
  usageEventsFetchStrategy?: TrendMeta["usageEventsFetchStrategy"];
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
  const analyticsPeriodBounds = boundsFromUserAnalyticsPeriod(input.analytics);
  let trendStartMs = input.rangeStartMs;
  let trendEndMs = input.rangeEndMs;
  let analyticsPeriodApplied = false;
  let analyticsPeriodStartMs: number | undefined;
  let analyticsPeriodEndMs: number | undefined;
  if (analyticsPeriodBounds) {
    const billingSpan = Math.max(0, input.rangeEndMs - input.rangeStartMs);
    const analyticsSpan = Math.max(
      0,
      analyticsPeriodBounds.endMs - analyticsPeriodBounds.startMs
    );
    // After a weekly pool reset the billing window can be minutes old while
    // get-user-analytics still covers ~30d. Prefer the wider analytics span so
    // Trend/Models are not blanked; otherwise keep the intersection.
    if (analyticsSpan > billingSpan) {
      trendStartMs = analyticsPeriodBounds.startMs;
      trendEndMs = Math.max(analyticsPeriodBounds.endMs, input.rangeEndMs);
    } else {
      const periodIntersection = intersectMsRanges(
        input.rangeStartMs,
        input.rangeEndMs,
        analyticsPeriodBounds.startMs,
        analyticsPeriodBounds.endMs
      );
      if (periodIntersection) {
        trendStartMs = periodIntersection.startMs;
        trendEndMs = periodIntersection.endMs;
      }
    }
    analyticsPeriodApplied = true;
    analyticsPeriodStartMs = analyticsPeriodBounds.startMs;
    analyticsPeriodEndMs = analyticsPeriodBounds.endMs;
  }
  const analyticsDays = analyticsDaysInRange(
    input.analytics,
    trendStartMs,
    trendEndMs
  );
  /** Trend chart + session drill-down only (plan totals still use full `events`). */
  const chartEvents = filterEventsToRange(events, trendStartMs, trendEndMs);
  // Group by routed model so Auto sessions show what actually served each request.
  const apiModels =
    events.length > 0
      ? modelsGroupedByRoutedModel(events)
      : modelsGroupedByRoutedFromAggregated(input.aggregated?.aggregations ?? []);
  const analyticsModels = modelsFromAnalytics(analyticsDays);
  const models = mergeModelsWithAnalytics({
    apiModels,
    analyticsModels,
    events,
    localConversations,
    localModels,
    rangeStartMs: trendStartMs,
    rangeEndMs: trendEndMs,
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

  const plan = buildPlanView(
    input.summary,
    input.me,
    input.sand,
    input.period,
    input.prepaid
  );
  const daily = mergeDailyWithAnalytics(
    dailyFromEvents(
      chartEvents,
      trendStartMs,
      trendEndMs,
      localConversations
    ),
    analyticsDays
  );
  const sessions = sessionsFromActivity({
    events: chartEvents,
    localConversations,
    localModels,
    rangeStartMs: trendStartMs,
    rangeEndMs: trendEndMs,
  });
  const trend = buildTrendMeta({
    events,
    localConversations,
    daily,
    rangeKind: input.rangeKind,
    includedPercentUsed: plan.includedPercentUsed,
    rangeStartMs: trendStartMs,
    latestKnownEventMs: input.latestKnownEventMs,
    usageEventsFetchStrategy: input.usageEventsFetchStrategy,
    unifiedBilling: input.sand?.isUnified === true,
    analyticsDays,
    analyticsPeriodApplied,
    analyticsPeriodStartMs,
    analyticsPeriodEndMs,
  });

  return {
    fetchedAt: new Date().toISOString(),
    plan,
    models,
    daily,
    sessions,
    trend,
    workspaces: input.workspaces,
    contextUsage: input.contextUsage,
    totals,
    error: input.error,
    authError: input.authError,
  };
}

/**
 * Choose the chart/fetch window for Trend, models, and sessions.
 *
 * Prefer a mature weekly sand window (what included % measures). Right after a
 * pool reset that window is nearly empty — fall through to the monthly summary
 * cycle (or period) so analytics history is not wiped from the dashboard.
 * Plan % still comes from sand via buildPlanView regardless of this range.
 */
export function resolveCycleRange(
  summary: UsageSummary | undefined,
  period: PeriodUsage | null | undefined,
  sand?: SandUsageStatus | null,
  fallbackDays = 30
): { startMs: number; endMs: number; rangeKind: TrendRangeKind } {
  const endMs = Date.now();
  /** Fresh weekly resets blank charts; require ~20h of history before using sand. */
  const MIN_USEFUL_WEEKLY_MS = 20 * 3600_000;

  const weeklyStart = asDateMs(sand?.currentPeriodStart);
  if (
    weeklyStart !== undefined &&
    endMs - weeklyStart >= MIN_USEFUL_WEEKLY_MS
  ) {
    return {
      startMs: weeklyStart,
      // Always fetch through now; a stale nextReset must not clip today's events.
      endMs,
      rangeKind: "weekly",
    };
  }

  // Prefer usage-summary's calendar month. On unified billing,
  // get-current-period-usage.billingCycleStart often mirrors the weekly sand
  // reset and would recreate the empty window we just skipped.
  const summaryStart = asDateMs(summary?.billingCycleStart);
  if (summaryStart !== undefined) {
    return {
      startMs: summaryStart,
      endMs,
      rangeKind: "monthly",
    };
  }

  const periodStart = asDateMs(period?.billingCycleStart);
  if (
    periodStart !== undefined &&
    endMs - periodStart >= MIN_USEFUL_WEEKLY_MS
  ) {
    return {
      startMs: periodStart,
      endMs,
      rangeKind: "monthly",
    };
  }

  return {
    startMs: endMs - fallbackDays * 86400000,
    endMs,
    rangeKind: "monthly",
  };
}
