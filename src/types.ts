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
  /** Distinct API conversationIds with events on this day. */
  matchedConversations: number;
}

/** How Trend/models window was chosen. */
export type TrendRangeKind = "weekly" | "monthly";

/** Hybrid Trend metadata: API events + local-first pending chats. */
export interface TrendMeta {
  rangeKind: TrendRangeKind;
  lastEventAt?: string;
  lastLocalAt?: string;
  pendingConversations: number;
  matchedConversations: number;
  /** True when plan usage suggests activity but API events lag (or only local pending). */
  eventsStale: boolean;
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

export interface DashboardData {
  fetchedAt: string;
  plan: PlanView;
  models: ModelBreakdown[];
  daily: DailyPoint[];
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
