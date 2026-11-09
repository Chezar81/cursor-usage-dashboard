import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyticsDaysInRange,
  asDateMs,
  billingItemsToUsageEvents,
  boundsFromUserAnalyticsPeriod,
  buildDashboardData,
  buildPlanView,
  dailyFromEvents,
  dailyModelsFromActivity,
  eventCostCents,
  eventTokens,
  filterEventsToRange,
  intersectMsRanges,
  dedupeModelsByLabel,
  mergeDailyWithAnalytics,
  mergeModelsWithAnalytics,
  mergeModelsWithLocal,
  modelEffectiveRequests,
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
  estimatedTokens = 0,
  estimatedRequests = 0,
  estimatedRequestsByDay?: Record<string, number>,
  estimatedTokensByDay?: Record<string, number>
): LocalConversationActivity {
  const dayKey = dayKeyLocal(lastActiveMs);
  return {
    conversationId: id,
    workspaceId: "file:///ws",
    displayName: "WS",
    lastActiveMs,
    dayKey,
    estimatedTokens,
    estimatedRequests,
    estimatedRequestsByDay:
      estimatedRequestsByDay ??
      (estimatedRequests > 0 ? { [dayKey]: estimatedRequests } : {}),
    estimatedTokensByDay:
      estimatedTokensByDay ??
      (estimatedTokens > 0 ? { [dayKey]: estimatedTokens } : {}),
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

test("filterEventsToRange drops out-of-range and undated events", () => {
  const base = 1_700_000_000_000;
  const events: FilteredUsageEvent[] = [
    { timestamp: base - 1000 },
    { timestamp: base },
    { timestamp: base + 1000 },
    {},
  ];
  assert.deepEqual(filterEventsToRange(events, base - 500, base + 500), [{ timestamp: base }]);
});

test("buildPlanView keeps sub-1% sand values and prefers weekly sand", () => {
  // Live API returns 0–100 already; 0.89 means ~1%, not 89%.
  const monthly = buildPlanView(
    { planUsage: { totalPercentUsed: 0.25 } },
    { email: "a@b.c" },
    null,
    null
  );
  assert.equal(monthly.includedPercentUsed, 0.25);
  assert.equal(monthly.email, "a@b.c");

  const subOne = buildPlanView(
    { planUsage: { totalPercentUsed: 0 } },
    undefined,
    { usagePercent: 0.8884073672806068, cursorPlanName: "Premium" },
    null
  );
  assert.equal(subOne.includedPercentUsed, 0.8884073672806068);
  assert.equal(subOne.includedLabel, "Weekly included usage");

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

test("resolveCycleRange skips fresh weekly reset in favor of summary month", () => {
  const freshSand = new Date(Date.now() - 30 * 60_000).toISOString(); // 30 min ago
  const summaryStart = "2026-11-01T00:00:00.000Z";
  // Unified APIs often mirror the weekly reset on period.billingCycleStart.
  const periodWeekly = String(Date.parse(freshSand));
  const range = resolveCycleRange(
    { billingCycleStart: summaryStart },
    { billingCycleStart: periodWeekly },
    { currentPeriodStart: freshSand, isUnified: true }
  );
  assert.equal(range.rangeKind, "monthly");
  assert.equal(range.startMs, Date.parse(summaryStart));
});

test("resolveCycleRange skips young period.billingCycleStart without summary", () => {
  const fresh = new Date(Date.now() - 10 * 60_000).toISOString();
  const range = resolveCycleRange(undefined, { billingCycleStart: fresh }, null);
  assert.equal(range.rangeKind, "monthly");
  assert.ok(Date.now() - range.startMs >= 29 * 86400000);
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

test("billing items become billed model, token, and cost rows", () => {
  const events = billingItemsToUsageEvents([
    {
      eventTime: new Date(at(2026, 10, 8, 15)).toISOString(),
      usageType: "on_demand",
      usage: {
        "prompt-text-tokens": "1000",
        "completion-text-tokens": "200",
        "cached-prompt-text-tokens": "3000",
        "cache-write-text-tokens": "40",
      },
      pricing: { currency: "USD", contracted: "0.0683232000" },
      displayExtras: { model: "grok-4.7-high-fast" },
    },
    {
      eventTime: new Date(at(2026, 10, 8, 16)).toISOString(),
      usageType: "included",
      usage: { "prompt-text-tokens": "10", "completion-text-tokens": "5" },
      pricing: { contracted: "0" },
      displayExtras: { model: "auto" },
    },
    { usageType: "included" },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "on_demand");
  assert.equal(events[0].model, "grok-4.7-high-fast");
  assert.ok(Math.abs((events[0].chargedCents ?? 0) - 6.83232) < 1e-6);
  assert.equal(events[0].tokenUsage?.cacheReadTokens, 3000);
  assert.equal(events[1].kind, "included");
  assert.equal(events[1].chargedCents, 0);

  const start = at(2026, 10, 6);
  const end = at(2026, 10, 9, 23);
  const data = buildDashboardData({
    sand: { isUnified: true, usagePercent: 1 },
    filtered: { usageEventsDisplay: events, totalUsageEventsCount: events.length },
    rangeStartMs: start,
    rangeEndMs: end,
    rangeKind: "weekly",
    usageEventsFetchStrategy: "billing-items",
    localConversations: [localConv("conv-local", at(2026, 10, 8, 15), 9000, 3)],
    workspaces: [],
    contextUsage: {
      percentFull: 0,
      usedTokens: 0,
      windowTokens: 256000,
      categories: [],
      estimated: true,
    },
  });
  const grok = data.models.find((m) => m.model === "grok-4.7-high-fast");
  assert.ok(grok);
  assert.equal(grok!.tokensEstimated, undefined);
  assert.equal(grok!.localPending, false);
  assert.equal(grok!.inputTokens, 1000);
  assert.equal(grok!.outputTokens, 200);
  assert.equal(grok!.cacheReadTokens, 3000);
  assert.equal(grok!.totalTokens, 4240);
  assert.ok(Math.abs(grok!.costCents - 6.83232) < 1e-6);
  const auto = data.models.find((m) => m.model === "Auto (Default)");
  assert.equal(auto?.autoRequests, 1);
  assert.equal(auto?.costCents, 0);
  assert.equal(data.trend?.apiEventsUnavailable, false);
  assert.equal(data.trend?.spendTrendUnavailable, undefined);
  assert.match(data.trend?.note ?? "", /billing items/);
  const day = data.daily.find((d) => d.tokens > 0);
  assert.ok(day);
  assert.ok((day!.costCents ?? 0) > 0);
  const onDemand = data.sessions.find((s) => s.title === "On-demand");
  assert.equal(onDemand?.model, "grok-4.7-high-fast");
  assert.equal(onDemand?.workspace, "Cursor billing");
  assert.equal(onDemand?.requests, 1);
  assert.equal(onDemand?.tokens, 4240);
  const included = data.sessions.find((s) => s.title === "Included");
  assert.equal(included?.model, "Auto (Default)");
  assert.equal(included?.costCents, 0);
});

test("intersectMsRanges returns overlap or null", () => {
  assert.deepEqual(intersectMsRanges(0, 100, 50, 150), { startMs: 50, endMs: 100 });
  assert.equal(intersectMsRanges(0, 10, 20, 30), null);
});

test("boundsFromUserAnalyticsPeriod parses period.startDate/endDate", () => {
  const b = boundsFromUserAnalyticsPeriod({
    period: {
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-31T23:59:59.000Z",
    },
  });
  assert.ok(b);
  assert.equal(b!.startMs, Date.parse("2026-01-01T00:00:00.000Z"));
  assert.equal(b!.endMs, Date.parse("2026-01-31T23:59:59.000Z"));
  assert.equal(boundsFromUserAnalyticsPeriod(null), null);
});

test("mergeDailyWithAnalytics adds coding fields and codingActivity score", () => {
  const dayMs = Date.parse("2026-06-10T00:00:00.000Z");
  const key = dayKeyLocal(dayMs);
  const daily = mergeDailyWithAnalytics(
    [
      {
        date: key,
        tokens: 0,
        costCents: 0,
        eventCount: 0,
        localPendingConversations: 0,
        localEstimatedTokens: 0,
        localEstimatedRequests: 0,
        matchedConversations: 0,
      },
    ],
    [
      {
        date: dayMs,
        agentRequests: 2,
        linesAdded: 10,
        linesDeleted: 3,
        totalApplies: 1,
        totalAccepts: 4,
      },
    ]
  );
  const p = daily.find((d) => d.date === key)!;
  assert.equal(p.linesAdded, 10);
  assert.equal(p.linesDeleted, 3);
  assert.equal(p.totalApplies, 1);
  assert.equal(p.totalAccepts, 4);
  assert.equal(p.codingActivity, 18);
});

test("buildDashboardData clips Trend to analytics period when billing window is wider", () => {
  const winStart = at(2026, 0, 1);
  const winEnd = at(2026, 0, 31, 23);
  const analytics = {
    period: {
      startDate: "2026-01-10T00:00:00.000Z",
      endDate: "2026-01-20T23:59:59.000Z",
    },
    dailyMetrics: [
      {
        date: "2026-01-15T00:00:00.000Z",
        agentRequests: 5,
        linesAdded: 100,
      },
    ],
  };
  const data = buildDashboardData({
    analytics,
    rangeStartMs: winStart,
    rangeEndMs: winEnd,
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
  assert.equal(data.trend?.analyticsPeriodApplied, true);
  assert.ok(data.trend?.note?.includes("Trend aligned to Cursor analytics period"));
  const day15 = new Date(2026, 0, 15);
  assert.ok(data.daily.some((d) => d.date === dayKeyLocal(day15.getTime())));
  assert.ok(!data.daily.some((d) => d.date === dayKeyLocal(at(2026, 0, 5))));
});

test("buildDashboardData expands Trend to analytics period after fresh weekly reset", () => {
  const freshStart = Date.now() - 15 * 60_000;
  const now = Date.now();
  const analyticsStart = Date.parse("2026-10-07T22:15:00.000Z");
  const analytics = {
    period: {
      startDate: String(analyticsStart),
      endDate: String(now),
    },
    dailyMetrics: [
      {
        date: String(Date.UTC(2026, 10, 5)),
        agentRequests: 105,
        modelUsage: [{ name: "default", count: 68 }],
      },
      {
        date: String(Date.UTC(2026, 10, 6)),
        agentRequests: 1,
        modelUsage: [{ name: "default", count: 1 }],
      },
    ],
  };
  const data = buildDashboardData({
    analytics,
    sand: { isUnified: true, usagePercent: 0 },
    rangeStartMs: freshStart,
    rangeEndMs: now,
    rangeKind: "weekly",
    workspaces: [],
    contextUsage: {
      percentFull: 0,
      usedTokens: 0,
      windowTokens: 256000,
      categories: [],
      estimated: true,
    },
  });
  assert.equal(data.trend?.analyticsPeriodApplied, true);
  assert.ok(data.daily.length > 1);
  assert.ok(
    data.models.some((m) => (m.analyticsRequests || 0) >= 60),
    "analytics model history must survive a fresh weekly window"
  );
  const nov5 = dayKeyLocal(Date.UTC(2026, 10, 5));
  assert.ok(
    data.daily.some((d) => d.date === nov5 && d.apiRequests === 105),
    "analytics days outside the tiny weekly window must appear on Trend"
  );
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

test("mergeModelsWithAnalytics prefers fresher local requests over stale analytics", () => {
  const analyticsModels = modelsFromAnalytics([
    {
      date: String(Date.UTC(2026, 10, 1)),
      modelUsage: [
        { name: "default", count: 10 },
        { name: "grok-4.7-high-fast", count: 40 },
      ],
    },
  ]);
  const start = at(2026, 9, 30);
  const end = at(2026, 10, 5, 23);
  const merged = mergeModelsWithAnalytics({
    apiModels: [],
    analyticsModels,
    events: [],
    localConversations: [
      localConv("c1", at(2026, 10, 4), 800, 25),
      localConv("c2", at(2026, 10, 4), 400, 15),
    ],
    localModels: [
      { conversationId: "c1", model: "default", lastActiveMs: at(2026, 10, 4) },
      {
        conversationId: "c2",
        model: "default",
        lastActiveMs: at(2026, 10, 4),
      },
    ],
    rangeStartMs: start,
    rangeEndMs: end,
  });
  const auto = merged.find((m) => m.model === "Auto (Default)")!;
  assert.equal(auto.analyticsRequests, 10);
  assert.equal(auto.localEstimatedRequests, 40);
  assert.equal(auto.localPending, true);
  assert.equal(modelEffectiveRequests(auto), 40);
  // Local-led Auto outranks stale analytics-heavy grok.
  assert.equal(merged[0].model, "Auto (Default)");
});

test("mergeModelsWithAnalytics clears localPending once analytics catches up", () => {
  const analyticsModels = modelsFromAnalytics([
    {
      date: String(Date.UTC(2026, 10, 2)),
      modelUsage: [{ name: "default", count: 50 }],
    },
  ]);
  const merged = mergeModelsWithAnalytics({
    apiModels: [],
    analyticsModels,
    events: [],
    localConversations: [localConv("c1", at(2026, 10, 2), 200, 12)],
    localModels: [
      { conversationId: "c1", model: "default", lastActiveMs: at(2026, 10, 2) },
    ],
    rangeStartMs: at(2026, 9, 30),
    rangeEndMs: at(2026, 10, 5, 23),
  });
  assert.equal(merged[0].localPending, false);
  assert.equal(merged[0].analyticsRequests, 50);
  assert.equal(merged[0].localEstimatedRequests, 12);
  assert.equal(modelEffectiveRequests(merged[0]), 50);
});

test("mergeModelsWithAnalytics consolidates billed API as third layer", () => {
  const apiModels: ModelBreakdown[] = [
    {
      modelIntent: "grok-4.7",
      model: "grok-4.7",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      costCents: 42,
      autoRequests: 0,
      manualRequests: 3,
    },
  ];
  const analyticsModels = modelsFromAnalytics([
    {
      date: String(Date.UTC(2026, 10, 2)),
      modelUsage: [
        { name: "grok-4.7", count: 8 },
        { name: "default", count: 20 },
      ],
    },
  ]);
  const merged = mergeModelsWithAnalytics({
    apiModels,
    analyticsModels,
    events: [{ conversationId: "billed-1" }],
    localConversations: [
      localConv("local-only", at(2026, 10, 2), 300, 5),
      localConv("billed-1", at(2026, 10, 2), 900, 9),
    ],
    localModels: [
      {
        conversationId: "local-only",
        model: "default",
        lastActiveMs: at(2026, 10, 2),
      },
      {
        conversationId: "billed-1",
        model: "grok-4.7",
        lastActiveMs: at(2026, 10, 2),
      },
    ],
    rangeStartMs: at(2026, 9, 30),
    rangeEndMs: at(2026, 10, 5, 23),
  });
  const grok = merged.find((m) => m.model === "grok-4.7")!;
  assert.equal(grok.costCents, 42);
  assert.equal(grok.totalTokens, 150);
  assert.equal(grok.tokensEstimated, undefined);
  assert.equal(grok.localPending, false);
  assert.equal(grok.analyticsRequests, 8);
  // Matched billed chat is excluded from local pending estimates.
  assert.equal(grok.localEstimatedRequests ?? 0, 0);
  const auto = merged.find((m) => m.model === "Auto (Default)")!;
  assert.equal(auto.analyticsRequests, 20);
  assert.equal(auto.localEstimatedRequests, 5);
  assert.equal(auto.localPending, false);
});

test("dailyModelsFromActivity scopes the three-layer merge to each local day", () => {
  const analyticsDays = [
    {
      date: String(Date.UTC(2026, 9, 30)),
      modelUsage: [{ name: "grok-4.7", count: 6 }],
    },
    {
      date: String(Date.UTC(2026, 10, 2)),
      modelUsage: [
        { name: "grok-4.7", count: 8 },
        { name: "default", count: 20 },
      ],
    },
  ];
  const events: FilteredUsageEvent[] = [
    {
      conversationId: "billed-1",
      timestamp: String(at(2026, 10, 3)),
      model: "grok-4.7",
      modelIntent: "grok-4.7",
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
      chargedCents: 42,
    },
  ];
  const localConversations = [
    localConv("local-only", at(2026, 10, 2), 300, 5),
    localConv("billed-1", at(2026, 10, 3), 900, 9),
  ];
  const localModels = [
    { conversationId: "local-only", model: "default", lastActiveMs: at(2026, 10, 2) },
    { conversationId: "billed-1", model: "grok-4.7", lastActiveMs: at(2026, 10, 3) },
  ];
  const rangeStartMs = at(2026, 9, 29, 0);
  const rangeEndMs = at(2026, 10, 5, 23);
  const days = dailyModelsFromActivity({
    events,
    analyticsDays,
    localConversations,
    localModels,
    rangeStartMs,
    rangeEndMs,
  });

  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-10-30", "2026-11-02", "2026-11-03"]
  );
  const oct = days[0].models;
  assert.equal(oct.length, 1);
  assert.equal(oct[0].model, "grok-4.7");
  assert.equal(oct[0].analyticsRequests, 6);

  const nov2 = days[1].models;
  const auto = nov2.find((m) => m.model === "Auto (Default)")!;
  assert.equal(auto.analyticsRequests, 20);
  assert.equal(auto.localEstimatedRequests, 5);
  assert.equal(nov2.find((m) => m.model === "grok-4.7")!.costCents, 0);

  // Billed tokens land on the event's day; the matched chat adds no local estimate.
  const nov3 = days[2].models;
  assert.equal(nov3.length, 1);
  assert.equal(nov3[0].costCents, 42);
  assert.equal(nov3[0].totalTokens, 150);
  assert.equal(nov3[0].localEstimatedRequests ?? 0, 0);

  // Summing every day reproduces the full-window request signal per label.
  const full = mergeModelsWithAnalytics({
    apiModels: [],
    analyticsModels: modelsFromAnalytics(analyticsDays),
    events,
    localConversations,
    localModels,
    rangeStartMs,
    rangeEndMs,
  });
  for (const row of full) {
    const summed = days.reduce(
      (s, d) =>
        s +
        (d.models.find((m) => m.model === row.model)?.analyticsRequests ?? 0),
      0
    );
    assert.equal(summed, row.analyticsRequests ?? 0, row.model);
  }
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

test("dailyFromEvents buckets local turns and tokens by day maps", () => {
  const start = at(2026, 10, 5, 0);
  const end = at(2026, 10, 6, 23);
  const daily = dailyFromEvents(
    [],
    start,
    end,
    [
      localConv("c1", at(2026, 10, 6, 15), 900, 5, {
        "2026-11-05": 2,
        "2026-11-06": 3,
      }, {
        "2026-11-05": 300,
        "2026-11-06": 600,
      }),
    ]
  );
  const d5 = daily.find((d) => d.date === "2026-11-05")!;
  const d6 = daily.find((d) => d.date === "2026-11-06")!;
  assert.equal(d5.localEstimatedRequests, 2);
  assert.equal(d6.localEstimatedRequests, 3);
  assert.equal(d5.localEstimatedTokens, 300);
  assert.equal(d6.localEstimatedTokens, 600);
});

test("unified billing still hides spend when a stale peek falls inside a widened analytics span", () => {
  const analyticsStart = Date.now() - 30 * 86400000;
  const stalePeek = Date.now() - 14 * 86400000;
  const data = buildDashboardData({
    sand: { isUnified: true, usagePercent: 0 },
    analytics: {
      period: {
        startDate: String(analyticsStart),
        endDate: String(Date.now()),
      },
      dailyMetrics: [
        {
          date: String(Date.now() - 86400000),
          agentRequests: 10,
          modelUsage: [{ name: "default", count: 10 }],
        },
      ],
    },
    rangeStartMs: Date.now() - 30 * 60_000,
    rangeEndMs: Date.now(),
    rangeKind: "weekly",
    latestKnownEventMs: stalePeek,
    usageEventsFetchStrategy: "wide-30d",
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
  assert.equal(data.trend?.spendTrendUnavailable, true);
  assert.equal(data.trend?.preferRequestsMetric, true);
  // Stale peek is inside the analytics-aligned axis, so it is not "before window".
  assert.equal(data.trend?.lastEventBeforeWindow, false);
});

test("buildDashboardData flags analytics lag and spend trend unavailable on unified billing", () => {
  const start = Date.now() - 3 * 86400000;
  const today = Date.now() - 60_000;
  const data = buildDashboardData({
    sand: { isUnified: true, usagePercent: 80 },
    analytics: {
      dailyMetrics: [
        {
          date: String(today - (today % 86400000)),
          agentRequests: 1,
          subscriptionIncludedReqs: 1,
          modelUsage: [{ name: "default", count: 1 }],
        },
      ],
    },
    rangeStartMs: start,
    rangeEndMs: Date.now(),
    rangeKind: "weekly",
    latestKnownEventMs: start - 600_000,
    usageEventsFetchStrategy: "wide-30d",
    localConversations: [
      localConv("c1", today, 1000, 8),
      localConv("c2", today, 800, 6),
    ],
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
  assert.equal(data.trend?.spendTrendUnavailable, true);
  assert.equal(data.trend?.analyticsLagging, true);
  const day = data.daily.find((d) => d.localEstimatedRequests > 0)!;
  assert.ok(day.localEstimatedRequests >= 14);
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
