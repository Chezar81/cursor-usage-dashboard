import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyticsDaysInRange,
  asDateMs,
  buildDashboardData,
  buildPlanView,
  dailyFromEvents,
  eventCostCents,
  eventTokens,
  filterEventsToRange,
  dedupeModelsByLabel,
  mergeDailyWithAnalytics,
  mergeModelsWithAnalytics,
  mergeModelsWithLocal,
  modelsFromAnalytics,
  resolveCycleRange,
  resolvePrepaidCredits,
  sessionsFromActivity,
  snapshotFromEvents,
  totalsFromModels,
} from "../src/aggregator";
import { dayKeyLocal } from "../src/dates";
import type { LocalConversationActivity } from "../src/localActivity";
import type { FilteredUsageEvent, ModelBreakdown } from "../src/types";

const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m, d, h).getTime();

function localConv(
  id: string,
  lastActiveMs: number,
  estimatedTokens = 0
): LocalConversationActivity {
  return {
    conversationId: id,
    workspaceId: "file:///ws",
    displayName: "WS",
    lastActiveMs,
    dayKey: dayKeyLocal(lastActiveMs),
    estimatedTokens,
    title: `Chat ${id}`,
  };
}

test("asDateMs handles ms, seconds, ISO and numeric strings", () => {
  assert.equal(asDateMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(asDateMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(asDateMs("1700000000"), 1_700_000_000_000);
  assert.equal(asDateMs("1700000000000.5"), 1_700_000_000_000.5);
  assert.equal(asDateMs("2026-01-15T00:00:00.000Z"), Date.parse("2026-01-15T00:00:00.000Z"));
  assert.equal(asDateMs(undefined), undefined);
  assert.equal(asDateMs(""), undefined);
  assert.equal(asDateMs("not a date"), undefined);
});

test("eventCostCents prefers chargedCents, then costCents, then usageBasedCosts", () => {
  assert.equal(eventCostCents({ chargedCents: 7, costCents: 9 }), 7);
  assert.equal(eventCostCents({ costCents: 9, usageBasedCosts: 11 }), 9);
  assert.equal(eventCostCents({ usageBasedCosts: 250 }), 250);
  // Dollar strings under 50 with decimals are converted to cents.
  assert.equal(eventCostCents({ usageBasedCosts: "$1.23" }), 123);
  assert.equal(eventCostCents({ usageBasedCosts: "0.05" }), 5);
  // Integer strings are treated as already-cents.
  assert.equal(eventCostCents({ usageBasedCosts: "12" }), 12);
  assert.equal(eventCostCents({}), 0);
});

test("eventTokens sums all token buckets and tolerates strings", () => {
  const ev: FilteredUsageEvent = {
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
    },
  };
  assert.equal(eventTokens(ev), 100);
  assert.equal(eventTokens({}), 0);
  assert.equal(snapshotFromEvents([ev, ev]).totalTokens, 200);
});

test("filterEventsToRange drops out-of-range and keeps undated events", () => {
  const base = 1_700_000_000_000;
  const events: FilteredUsageEvent[] = [
    { timestamp: base - 1000 },
    { timestamp: base },
    { timestamp: base + 1000 },
    {},
  ];
  assert.deepEqual(filterEventsToRange(events, base - 500, base + 500), [
    { timestamp: base },
    {},
  ]);
});

test("buildPlanView converts fractional percents and prefers weekly sand", () => {
  const monthly = buildPlanView(
    { planUsage: { totalPercentUsed: 0.25 } },
    { email: "a@b.c" },
    null,
    null
  );
  assert.equal(monthly.includedPercentUsed, 25);
  assert.equal(monthly.email, "a@b.c");

  const weekly = buildPlanView(
    { planUsage: { totalPercentUsed: 0 } },
    undefined,
    { usagePercent: 42.5, cursorPlanName: "Premium" },
    null
  );
  assert.equal(weekly.includedPercentUsed, 42.5);
  assert.equal(weekly.includedLabel, "Weekly included usage");
  assert.equal(weekly.membershipType, "Premium");
});

test("resolvePrepaidCredits parses Connect-RPC string cents", () => {
  const resolved = resolvePrepaidCredits({
    eligible: true,
    availableCents: "381",
    fundedCents: 500,
    spentThisMonthCents: "119",
  });
  assert.deepEqual(resolved, {
    availableCents: 381,
    totalCents: 500,
    spentThisMonthCents: 119,
    prepaidBilling: true,
  });
  assert.equal(resolvePrepaidCredits({ eligible: false }).prepaidBilling, false);
  assert.equal(resolvePrepaidCredits(null).availableCents, null);
});

test("buildPlanView surfaces prepaid spend as the balance figure", () => {
  const plan = buildPlanView(
    { membershipType: "Premium" },
    undefined,
    null,
    null,
    { eligible: true, availableCents: 381, spentThisMonthCents: 119 }
  );
  assert.equal(plan.onDemandUsedCents, 119);
  assert.equal(plan.creditsAvailableCents, 381);
  assert.equal(plan.prepaidBilling, true);
});

test("resolveCycleRange prefers weekly sand, then billing cycle, then 30d", () => {
  const sandStart = "2026-10-23T20:08:06.633Z";
  const weekly = resolveCycleRange(undefined, null, {
    currentPeriodStart: sandStart,
  });
  assert.equal(weekly.rangeKind, "weekly");
  assert.equal(weekly.startMs, Date.parse(sandStart));

  const monthly = resolveCycleRange(
    { billingCycleStart: "2026-10-01T00:00:00.000Z" },
    null,
    null
  );
  assert.equal(monthly.rangeKind, "monthly");
  assert.equal(monthly.startMs, Date.parse("2026-10-01T00:00:00.000Z"));

  const fallback = resolveCycleRange(undefined, null, null);
  assert.equal(fallback.rangeKind, "monthly");
  assert.ok(Date.now() - fallback.startMs <= 30 * 86400000 + 5000);
});

test("dailyFromEvents buckets API tokens and adds unmatched local estimates", () => {
  const start = at(2026, 9, 23);
  const end = at(2026, 9, 25, 23);
  const events: FilteredUsageEvent[] = [
    {
      timestamp: at(2026, 9, 24, 10),
      conversationId: "conv-a",
      tokenUsage: { inputTokens: 60, outputTokens: 40 },
      chargedCents: 12,
    },
  ];
  const locals = [
    localConv("conv-a", at(2026, 9, 24, 11), 999), // matched → not pending
    localConv("conv-b", at(2026, 9, 25, 9), 500),
  ];
  const daily = dailyFromEvents(events, start, end, locals);
  assert.equal(daily.length, 3);
  const d24 = daily.find((d) => d.date === "2026-10-24")!;
  assert.equal(d24.tokens, 100);
  assert.equal(d24.costCents, 12);
  assert.equal(d24.matchedConversations, 1);
  assert.equal(d24.localPendingConversations, 0);
  const d25 = daily.find((d) => d.date === "2026-10-25")!;
  assert.equal(d25.tokens, 0);
  assert.equal(d25.localPendingConversations, 1);
  assert.equal(d25.localEstimatedTokens, 500);
});

test("sessionsFromActivity groups per chat/day and marks pending chats", () => {
  const start = at(2026, 9, 23);
  const end = at(2026, 9, 25, 23);
  const events: FilteredUsageEvent[] = [
    {
      timestamp: at(2026, 9, 24, 10),
      conversationId: "conv-a",
      modelIntent: "default",
      model: "grok-4.6",
      tokenUsage: { inputTokens: 70, outputTokens: 30 },
      chargedCents: 30,
    },
    {
      timestamp: at(2026, 9, 24, 11),
      conversationId: "conv-a",
      modelIntent: "default",
      model: "grok-4.6",
      tokenUsage: { inputTokens: 10 },
      chargedCents: 5,
    },
  ];
  const sessions = sessionsFromActivity({
    events,
    localConversations: [
      localConv("conv-a", at(2026, 9, 24, 11)),
      localConv("conv-b", at(2026, 9, 25, 9), 400),
    ],
    localModels: [{ conversationId: "conv-b", model: "default", lastActiveMs: at(2026, 9, 25, 9) }],
    rangeStartMs: start,
    rangeEndMs: end,
  });
  const api = sessions.find((s) => s.conversationId === "conv-a")!;
  assert.equal(api.requests, 2);
  assert.equal(api.tokens, 110);
  assert.equal(api.costCents, 35);
  assert.equal(api.model, "grok-4.6");
  assert.equal(api.localPending, undefined);
  const pending = sessions.find((s) => s.conversationId === "conv-b")!;
  assert.equal(pending.localPending, true);
  assert.equal(pending.tokensEstimated, true);
  assert.equal(pending.tokens, 400);
});

test("mergeModelsWithLocal appends provisional rows only for unmatched chats", () => {
  const apiModels: ModelBreakdown[] = [
    {
      modelIntent: "grok-4.6",
      model: "grok-4.6",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 15,
      costCents: 3,
    },
  ];
  const events: FilteredUsageEvent[] = [{ conversationId: "conv-a" }];
  const merged = mergeModelsWithLocal({
    apiModels,
    events,
    localConversations: [
      localConv("conv-a", at(2026, 9, 24), 100),
      localConv("conv-b", at(2026, 9, 24), 700),
    ],
    localModels: [
      { conversationId: "conv-b", model: "grok-4.7", lastActiveMs: at(2026, 9, 24) },
    ],
    rangeStartMs: at(2026, 9, 23),
    rangeEndMs: at(2026, 9, 25, 23),
  });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].localPending, false);
  assert.equal(merged[1].localPending, true);
  assert.equal(merged[1].model, "grok-4.7");
  assert.equal(merged[1].totalTokens, 700);
  assert.equal(merged[1].pendingConversations, 1);
});

test("buildDashboardData flags unified billing with no published events as unavailable, not lagging", () => {
  const start = Date.now() - 3 * 86400000;
  const base = {
    rangeStartMs: start,
    rangeEndMs: Date.now(),
    rangeKind: "weekly" as const,
    latestKnownEventMs: start - 600_000,
    usageEventsFetchStrategy: "wide-30d" as const,
    localConversations: [localConv("conv-x", Date.now() - 3600_000, 100)],
    workspaces: [],
    contextUsage: {
      percentFull: 0,
      usedTokens: 0,
      windowTokens: 256000,
      categories: [],
      estimated: true,
    },
  };
  const unified = buildDashboardData({
    ...base,
    sand: { isUnified: true, usagePercent: 64 },
  });
  assert.equal(unified.trend?.apiEventsUnavailable, true);
  assert.equal(unified.trend?.lastEventBeforeWindow, true);

  // Same gap on a classic plan is ordinary lag, not structural unavailability.
  const classic = buildDashboardData({ ...base, sand: { usagePercent: 64 } });
  assert.equal(classic.trend?.apiEventsUnavailable, false);
});

test("analyticsDaysInRange and mergeDailyWithAnalytics overlay request counts", () => {
  const dayMs = Date.UTC(2026, 10, 2); // Nov 2 00:00 UTC
  const start = Date.UTC(2026, 9, 30);
  const end = Date.UTC(2026, 10, 5, 23);
  const inRange = analyticsDaysInRange(
    {
      dailyMetrics: [
        {
          date: String(dayMs),
          agentRequests: 123,
          subscriptionIncludedReqs: 117,
          usageBasedReqs: 6,
          modelUsage: [{ name: "default", count: 113 }],
        },
        {
          date: String(Date.UTC(2026, 9, 20)),
          agentRequests: 9,
        },
      ],
    },
    start,
    end
  );
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0].agentRequests, 123);

  const daily = dailyFromEvents([], start, end, []);
  const merged = mergeDailyWithAnalytics(daily, inRange);
  const point = merged.find((d) => d.date === dayKeyLocal(dayMs))!;
  assert.equal(point.apiRequests, 123);
  assert.equal(point.includedRequests, 117);
  assert.equal(point.usageBasedRequests, 6);
});

test("modelsFromAnalytics aggregates request counts and merge prefers them without billed tokens", () => {
  const analyticsModels = modelsFromAnalytics([
    {
      date: String(Date.UTC(2026, 10, 2)),
      modelUsage: [
        { name: "default", count: 100 },
        { name: "grok-4.7-high-fast", count: 20 },
      ],
    },
    {
      date: String(Date.UTC(2026, 10, 3)),
      modelUsage: [
        { name: "default", count: 13 },
        { name: "claude-sonnet-5-5-high", count: 6 },
      ],
    },
  ]);
  assert.equal(analyticsModels[0].model, "Auto (Default)");
  assert.equal(analyticsModels[0].analyticsRequests, 113);
  assert.equal(analyticsModels[0].autoRequests, 113);

  const start = at(2026, 9, 30);
  const end = at(2026, 10, 5, 23);
  const merged = mergeModelsWithAnalytics({
    apiModels: [],
    analyticsModels,
    events: [],
    localConversations: [localConv("c1", at(2026, 10, 2), 500)],
    localModels: [
      { conversationId: "c1", model: "default", lastActiveMs: at(2026, 10, 2) },
    ],
    rangeStartMs: start,
    rangeEndMs: end,
  });
  const autos = merged.filter((m) => m.model === "Auto (Default)");
  assert.equal(autos.length, 1, "API/analytics and local must be one row");
  const auto = autos[0]!;
  assert.equal(auto.analyticsRequests, 113);
  assert.equal(auto.localPending, false);
  assert.equal(auto.tokensEstimated, true);
  assert.equal(auto.totalTokens, 500);
  assert.equal(auto.pendingConversations, 1);
  assert.ok(merged.some((m) => m.model === "grok-4.7-high-fast"));
});

test("dedupeModelsByLabel collapses API + local duplicate into one API row", () => {
  const deduped = dedupeModelsByLabel([
    {
      modelIntent: "Auto (Default)",
      model: "Auto (Default)",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1106088,
      costCents: 0,
      localPending: true,
      pendingConversations: 48,
      tokensEstimated: true,
      analyticsRequests: 286,
    },
    {
      modelIntent: "Auto (Default)",
      model: "Auto (Default)",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costCents: 0,
      localPending: false,
      analyticsRequests: 286,
    },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].localPending, false);
  assert.equal(deduped[0].analyticsRequests, 286);
  assert.equal(deduped[0].totalTokens, 1106088);
  assert.equal(deduped[0].tokensEstimated, true);
  assert.equal(deduped[0].pendingConversations, 48);
});

test("mergeModelsWithLocal folds local estimates into matching API rows", () => {
  const apiModels: ModelBreakdown[] = [
    {
      modelIntent: "Auto (Default)",
      model: "Auto (Default)",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costCents: 0,
      analyticsRequests: 40,
    },
  ];
  const merged = mergeModelsWithLocal({
    apiModels,
    events: [],
    localConversations: [
      localConv("a", at(2026, 10, 2), 100),
      localConv("b", at(2026, 10, 2), 200),
    ],
    localModels: [
      { conversationId: "a", model: "default", lastActiveMs: at(2026, 10, 2) },
      { conversationId: "b", model: "default", lastActiveMs: at(2026, 10, 2) },
    ],
    rangeStartMs: at(2026, 9, 30),
    rangeEndMs: at(2026, 10, 5, 23),
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].localPending, false);
  assert.equal(merged[0].analyticsRequests, 40);
  assert.equal(merged[0].totalTokens, 300);
  assert.equal(merged[0].tokensEstimated, true);
  assert.equal(merged[0].pendingConversations, 2);
});

test("buildDashboardData prefers Requests metric when analytics is live on unified billing", () => {
  const start = Date.now() - 3 * 86400000;
  const dayMs = Date.now() - 86400000;
  const data = buildDashboardData({
    sand: { isUnified: true, usagePercent: 50 },
    analytics: {
      dailyMetrics: [
        {
          date: String(dayMs),
          agentRequests: 33,
          subscriptionIncludedReqs: 33,
          modelUsage: [{ name: "default", count: 33 }],
        },
      ],
    },
    rangeStartMs: start,
    rangeEndMs: Date.now(),
    rangeKind: "weekly",
    latestKnownEventMs: start - 600_000,
    usageEventsFetchStrategy: "wide-30d",
    localConversations: [localConv("c1", Date.now() - 3600_000, 100)],
    workspaces: [],
    contextUsage: {
      percentFull: 0,
      usedTokens: 0,
      windowTokens: 256000,
      categories: [],
      estimated: true,
    },
  });
  assert.equal(data.trend?.apiEventsUnavailable, true);
  assert.equal(data.trend?.analyticsAvailable, true);
  assert.equal(data.trend?.preferRequestsMetric, true);
  assert.equal(data.trend?.analyticsRequests, 33);
  assert.ok((data.daily.find((d) => (d.apiRequests || 0) > 0)?.apiRequests || 0) >= 33);
});

test("totalsFromModels sums rows", () => {
  const totals = totalsFromModels([
    {
      modelIntent: "a",
      model: "a",
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      totalTokens: 10,
      costCents: 5,
    },
  ]);
  assert.deepEqual(totals, {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 4,
    costCents: 5,
  });
});

test("buildDashboardData groups aggregated rows by routed model (monthly totals)", () => {
  const data = buildDashboardData({
    summary: { membershipType: "Pro", billingCycleStart: "2026-10-01T00:00:00Z" },
    aggregated: {
      aggregations: [
        { modelIntent: "default", model: "grok-4.6", inputTokens: 10, outputTokens: 1, totalCents: 40 },
        { modelIntent: "grok-4.6", model: "grok-4.6", inputTokens: 5, outputTokens: 1, totalCents: 2 },
      ],
      totalInputTokens: 15,
      totalOutputTokens: 2,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCostCents: 42,
    },
    rangeStartMs: at(2026, 9, 1),
    rangeEndMs: at(2026, 9, 25, 23),
    rangeKind: "monthly",
    workspaces: [],
    contextUsage: {
      percentFull: 0,
      usedTokens: 0,
      windowTokens: 256000,
      categories: [],
      estimated: true,
    },
  });
  assert.equal(data.models.length, 1);
  assert.equal(data.models[0].model, "grok-4.6");
  assert.equal(data.models[0].costCents, 42);
  assert.equal(data.totals.costCents, 42);
  assert.equal(data.totals.inputTokens, 15);
});
