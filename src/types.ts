/** Shared types for Cursor usage payloads and dashboard view models. */

export interface AuthMe {
  email?: string;
  name?: string;
  id?: string;
  membershipType?: string;
  subscriptionStatus?: string;
}

export interface UsageSummary {
  membershipType?: string;
  billingCycleStart?: string;
  billingCycleEnd?: string;
  /** Included request / dollar pool used (0–100 or fraction depending on API). */
  individualUsage?: {
    plan?: {
      enabled?: boolean;
      used?: number;
      limit?: number;
      remaining?: number;
    };
    onDemand?: {
      enabled?: boolean;
      used?: number;
      limit?: number | null;
      remaining?: number | null;
    };
  };
  /** Alternate shapes seen across Cursor versions. */
  planUsage?: {
    totalPercentUsed?: number;
    used?: number;
    limit?: number;
  };
  onDemandUsage?: {
    usedCents?: number;
    used?: number;
  };
  nextResetDate?: string;
  /** Raw pass-through for aggregator flexibility. */
  [key: string]: unknown;
}

export interface AggregatedUsageEventsResponse {
  aggregations?: AggregatedModelUsage[];
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  totalCostCents?: number;
  [key: string]: unknown;
}

export interface AggregatedModelUsage {
  modelIntent?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCents?: number;
  costCents?: number;
  [key: string]: unknown;
}

export interface FilteredUsageEvent {
  timestamp?: string | number;
  model?: string;
  modelIntent?: string;
  kind?: string;
  conversationId?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  usageBasedCosts?: string | number;
  chargedCents?: number;
  costCents?: number;
  [key: string]: unknown;
}

export interface FilteredUsageEventsResponse {
  usageEventsDisplay?: FilteredUsageEvent[];
  totalUsageEventsCount?: number;
  [key: string]: unknown;
}

export interface PeriodUsage {
  billingCycleStart?: string | number;
  billingCycleEnd?: string | number;
  displayMessage?: string;
  planUsage?: {
    autoPercentUsed?: number;
    apiPercentUsed?: number;
    totalPercentUsed?: number;
  };
  [key: string]: unknown;
}

/** Payload from get-sand-usage-status (Grok / unified weekly pool). */
export interface SandUsageStatus {
  usagePercent?: number;
  currentPeriodStart?: string;
  nextResetTimestampUtc?: string;
  cursorPlanName?: string;
  grokPlanLabel?: string;
  isUnified?: boolean;
  hasAvailableUsage?: boolean;
  /** Older shapes */
  used?: number;
  limit?: number;
  remaining?: number;
  resetAt?: string;
  [key: string]: unknown;
}

/**
 * Prepaid wallet from get-user-prepaid-billing — same source as
 * grok.com/dashboard “Account balance” / “Credits available”.
 */
export interface UserPrepaidBilling {
  billingMode?: string;
  eligible?: boolean;
  /** Credits available (USD cents; Connect RPC may send string). */
  availableCents?: number | string;
  fundedCents?: number | string;
  spentCents?: number | string;
  spentThisMonthCents?: number | string;
  hasPaymentMethod?: boolean;
  [key: string]: unknown;
}

/**
 * Live activity from get-user-analytics — works on unified Grok billing
 * even when per-chat token events are empty. Counts requests, not tokens.
 */
export interface UserAnalyticsResponse {
  period?: {
    startDate?: string | number;
    endDate?: string | number;
  };
  dailyMetrics?: UserAnalyticsDay[];
  [key: string]: unknown;
}

export interface UserAnalyticsDay {
  /** Epoch ms (often UTC midnight as string). */
  date?: string | number;
  agentRequests?: number;
  subscriptionIncludedReqs?: number;
  usageBasedReqs?: number;
  modelUsage?: Array<{ name?: string; count?: number }>;
  linesAdded?: number;
  linesDeleted?: number;
  totalApplies?: number;
  totalAccepts?: number;
  [key: string]: unknown;
}

export interface ModelBreakdown {
  /** Selected / requested model (Cursor `modelIntent`). */
  modelIntent: string;
  /** Model that served the request when known (Cursor `model`). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costCents: number;
  /**
   * True when this row is only from local tracking / transcripts and the
   * usage API has not yet attributed tokens for these conversations.
   */
  localPending?: boolean;
  /** Distinct local chats still waiting for API events (provisional rows). */
  pendingConversations?: number;
  /**
   * True when totalTokens is a local transcript estimate (chars÷4), not
   * billed API usage.
   */
  tokensEstimated?: boolean;
  /** Usage events where picker was Auto / router (when from API). */
  autoRequests?: number;
  /** Usage events with an explicit non-Auto model intent. */
  manualRequests?: number;
  /**
   * Agent request count from get-user-analytics for this model (live on
   * unified billing; not the same as billed token events).
   */
  analyticsRequests?: number;
  /**
   * Local transcript user-turn estimate for unmatched chats of this model
   * (chars÷4 tokens live in totalTokens when tokensEstimated). Used to keep
   * Top models fresh when Cursor analytics / billed events lag.
   */
  localEstimatedRequests?: number;
}

export interface DailyPoint {
  /** Local calendar day YYYY-MM-DD */
  date: string;
  /** Authoritative tokens from Cursor usage events (0 if API has not caught up). */
  tokens: number;
  costCents: number;
  eventCount: number;
  /** Local chats active this day whose conversationId is not yet in the API. */
  localPendingConversations: number;
  /**
   * Sum of local transcript token estimates for pending chats on this day
   * (chars÷4). Not billed usage.
   */
  localEstimatedTokens: number;
  /**
   * Sum of local user-turn counts for pending chats on this day.
   * Stand-in when Cursor analytics under-reports agentRequests.
   */
  localEstimatedRequests: number;
  /** Distinct API conversationIds with events on this day. */
  matchedConversations: number;
  /** Agent requests from get-user-analytics (live on unified billing). */
  apiRequests?: number;
  /** Included-pool requests from analytics. */
  includedRequests?: number;
  /** Usage-based / on-demand requests from analytics. */
  usageBasedRequests?: number;
  /** From get-user-analytics daily metrics (when Cursor fills them). */
  linesAdded?: number;
  linesDeleted?: number;
  totalApplies?: number;
  totalAccepts?: number;
  /**
   * Single series for Trend “Code”: sum of analytics lines±, applies, accepts when any > 0.
   */
  codingActivity?: number;
}

/**
 * One agent chat’s usage on a single local calendar day.
 * A chat that spans days appears once per day, with that day’s tokens and cost.
 */
export interface DaySession {
  /** Local calendar day YYYY-MM-DD */
  date: string;
  conversationId: string;
  /** First user message, shortened. */
  title: string;
  /** Project folder the chat belongs to, when known locally. */
  workspace: string;
  /** Model that served most of this day’s usage (by cost, then tokens). */
  model: string;
  /** Requested model when it differs from `model`. */
  modelIntent?: string;
  /** Distinct models on this chat this day. Above 1, the UI shows “+n”. */
  modelCount?: number;
  /** Usage events Cursor recorded for this chat on this day. */
  requests: number;
  tokens: number;
  costCents: number;
  /** True when this row is only a local transcript (API has no events yet). */
  localPending?: boolean;
  /** True when `tokens` is a transcript estimate (chars÷4), not billed usage. */
  tokensEstimated?: boolean;
}

/** How Trend/models window was chosen. */
export type TrendRangeKind = "weekly" | "monthly";

/** Hybrid Trend metadata: API events + local-first pending chats. */
export interface TrendMeta {
  rangeKind: TrendRangeKind;
  lastEventAt?: string;
  /**
   * True when `lastEventAt` is the newest event Cursor has published and it
   * falls before the chart window (the in-window query was empty).
   */
  lastEventBeforeWindow?: boolean;
  lastLocalAt?: string;
  pendingConversations: number;
  matchedConversations: number;
  /** True when plan usage suggests activity but API events lag (or only local pending). */
  eventsStale: boolean;
  /**
   * True when Cursor is structurally not publishing per-chat token events
   * for this account (unified SAND/Grok billing: pool % is live, but the
   * filtered/aggregated event endpoints have returned nothing since the
   * current period started >24h ago). Local estimates are then the primary
   * per-chat source — they are not "waiting for the API to catch up".
   * Clears automatically if billed events ever appear in the window.
   */
  apiEventsUnavailable?: boolean;
  /** True when get-user-analytics returned daily metrics for this window. */
  analyticsAvailable?: boolean;
  /** Sum of analytics agentRequests in the chart window. */
  analyticsRequests?: number;
  /**
   * True when local user-turn estimates clearly outpace Cursor analytics for
   * recent days (common lag on unified billing).
   */
  analyticsLagging?: boolean;
  /**
   * Prefer the Requests trend metric when token events are unavailable but
   * analytics request counts are live.
   */
  preferRequestsMetric?: boolean;
  /**
   * True when spend trend has no Cursor cost events — do not invent a daily
   * spend series; prepaid cents in Plan remain the real money figure.
   */
  spendTrendUnavailable?: boolean;
  /** How filtered usage events were loaded when the primary window was empty. */
  usageEventsFetchStrategy?:
    | "primary"
    | "primary-seconds"
    | "wide-30d"
    | "unbounded"
    | "empty";
  /**
   * When get-user-analytics includes `period`, the Trend chart uses the
   * intersection with the billing/weekly window so axes match Cursor's analytics range.
   */
  analyticsPeriodApplied?: boolean;
  analyticsPeriodStartMs?: number;
  analyticsPeriodEndMs?: number;
  note?: string;
}

export interface PlanView {
  membershipType: string;
  email?: string;
  /** ISO or displayable date for weekly/monthly window start */
  cycleStart?: string;
  cycleEnd?: string;
  nextReset?: string;
  /** Primary ring: prefer weekly Grok/sand % (matches Overview). */
  includedPercentUsed: number | null;
  includedUsed?: number;
  includedLimit?: number;
  includedLabel?: string;
  onDemandUsedCents: number | null;
  onDemandEnabled: boolean;
  onDemandLimitCents?: number | null;
  /**
   * Prepaid credits available (USD cents) — matches grok.com
   * “Credits available” from get-user-prepaid-billing.
   */
  creditsAvailableCents?: number | null;
  /** Total funded into the prepaid wallet when known (USD cents). */
  creditsTotalCents?: number | null;
  /** True when account uses prepaid billing (X / Premium merged plans). */
  prepaidBilling?: boolean;
  displayMessage?: string;
  sandPool?: {
    used: number;
    limit: number;
    remaining: number;
    resetAt?: string;
  };
}

export interface WorkspaceStat {
  workspaceId: string;
  displayName: string;
  tokens: number;
  costCents: number;
  lastActiveAt: string;
  /**
   * True when this row is only from a local transcript (API has not
   * attributed tokens to this conversation yet).
   */
  localPending?: boolean;
  /**
   * True when `tokens` is a local transcript estimate (chars÷4), not billed
   * API usage. Cleared once API events attribute real totals.
   */
  tokensEstimated?: boolean;
}

/** Local estimate of chat context-window breakdown (Cursor tray categories). */
export interface ContextUsageCategory {
  id:
    | "systemPrompt"
    | "toolDefinitions"
    | "rules"
    | "skills"
    | "mcp"
    | "subagents"
    | "conversation";
  label: string;
  tokens: number;
  color: string;
}

export interface ContextUsageView {
  percentFull: number;
  usedTokens: number;
  windowTokens: number;
  categories: ContextUsageCategory[];
  /**
   * False when numbers come from Cursor's local composerData
   * `promptTokenBreakdown` (same source as the chat Context Usage tray).
   * True for file-based fallback estimates.
   */
  estimated: boolean;
  note?: string;
}

/** Top-models merge scoped to one local calendar day (Trend month filter). */
export interface DailyModels {
  date: string;
  models: ModelBreakdown[];
}

export interface DashboardData {
  fetchedAt: string;
  plan: PlanView;
  models: ModelBreakdown[];
  /** Days with model activity only; summed client-side per Trend month. */
  dailyModels?: DailyModels[];
  daily: DailyPoint[];
  /** Agent chats per day, for the Trend drill-down. */
  sessions: DaySession[];
  trend?: TrendMeta;
  workspaces: WorkspaceStat[];
  contextUsage: ContextUsageView;
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costCents: number;
  };
  error?: string;
  authError?: boolean;
}

export interface UsageSnapshot {
  at: string;
  totalTokens: number;
  costCents: number;
  eventCount: number;
}

export interface WorkspaceStore {
  version: 1;
  lastSnapshot?: UsageSnapshot;
  workspaces: Record<
    string,
    {
      displayName: string;
      tokens: number;
      costCents: number;
      lastActiveAt: string;
      /**
       * True when `tokens` is a local transcript estimate (chars÷4), not
       * billed API usage. Persisted so pending rows keep updating and are
       * not mistaken for final attribution after reload.
       */
      tokensEstimated?: boolean;
    }
  >;
  /**
   * Active workspace windows for time-based fallback.
   * `sessionId` is vscode.env.sessionId so multiple Cursor windows
   * can stay open concurrently without clobbering each other.
   */
  windows: Array<{
    workspaceId: string;
    displayName: string;
    startedAt: string;
    endedAt?: string;
    sessionId?: string;
    /** Updated when this Cursor window is focused. */
    lastFocusedAt?: string;
  }>;
}
