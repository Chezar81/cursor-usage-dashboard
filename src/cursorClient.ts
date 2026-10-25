import type {
  AggregatedUsageEventsResponse,
  AuthMe,
  FilteredUsageEvent,
  FilteredUsageEventsResponse,
  PeriodUsage,
  SandUsageStatus,
  UsageSummary,
  UserPrepaidBilling,
} from "./types";

const BASE = "https://cursor.com";
const TOKEN_SECRET_KEY = "cursorUsage.sessionToken";

export class CursorAuthError extends Error {
  constructor(
    message = "Cursor session missing or expired. Sign in to Cursor again (manual token is only a fallback)."
  ) {
    super(message);
    this.name = "CursorAuthError";
  }
}

export class CursorApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string
  ) {
    super(message);
    this.name = "CursorApiError";
  }
}

export class CursorDashboardClient {
  constructor(
    private readonly getToken: () => Thenable<string | undefined> | Promise<string | undefined>
  ) {}

  async getAuthMe(): Promise<AuthMe> {
    return this.getJson<AuthMe>("/api/auth/me");
  }

  async getUsageSummary(): Promise<UsageSummary> {
    return this.getJson<UsageSummary>("/api/usage-summary");
  }

  async getAggregatedUsageEvents(opts: {
    startDate: number;
    endDate: number;
    teamId?: number;
  }): Promise<AggregatedUsageEventsResponse> {
    return this.postJson<AggregatedUsageEventsResponse>(
      "/api/dashboard/get-aggregated-usage-events",
      {
        startDate: opts.startDate,
        endDate: opts.endDate,
        teamId: opts.teamId ?? 0,
      }
    );
  }

  async getFilteredUsageEvents(opts: {
    startDate?: number;
    endDate?: number;
    page?: number;
    pageSize?: number;
    teamId?: number;
  }): Promise<FilteredUsageEventsResponse> {
    const body: Record<string, unknown> = {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 500,
      teamId: opts.teamId ?? 0,
    };
    if (opts.startDate !== undefined) {
      body.startDate = opts.startDate;
    }
    if (opts.endDate !== undefined) {
      body.endDate = opts.endDate;
    }
    return this.postJson<FilteredUsageEventsResponse>(
      "/api/dashboard/get-filtered-usage-events",
      body
    );
  }

  /** Fetch every page of filtered usage events for the range (cap pages for safety). */
  async getAllFilteredUsageEvents(opts: {
    startDate?: number;
    endDate?: number;
    pageSize?: number;
    teamId?: number;
    maxPages?: number;
  }): Promise<FilteredUsageEventsResponse> {
    const pageSize = opts.pageSize ?? 500;
    const maxPages = opts.maxPages ?? 20;
    const all: NonNullable<FilteredUsageEventsResponse["usageEventsDisplay"]> =
      [];
    let totalUsageEventsCount = 0;

    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.getFilteredUsageEvents({
        startDate: opts.startDate,
        endDate: opts.endDate,
        page,
        pageSize,
        teamId: opts.teamId,
      });
      const rows = batch.usageEventsDisplay ?? [];
      if (typeof batch.totalUsageEventsCount === "number") {
        totalUsageEventsCount = batch.totalUsageEventsCount;
      }
      all.push(...rows);
      if (rows.length < pageSize) {
        break;
      }
      if (
        totalUsageEventsCount > 0 &&
        all.length >= totalUsageEventsCount
      ) {
        break;
      }
    }

    return {
      usageEventsDisplay: all,
      totalUsageEventsCount: totalUsageEventsCount || all.length,
    };
  }

  /**
   * Load usage events, retrying alternate date shapes when the primary window
   * is empty (Cursor has shipped both ms and second epochs; unified billing
   * sometimes omits rows until an unbounded query).
   */
  async getAllFilteredUsageEventsWithFallback(opts: {
    startDate: number;
    endDate: number;
    pageSize?: number;
    teamId?: number;
    maxPages?: number;
  }): Promise<{
    response: FilteredUsageEventsResponse;
    fetchStrategy:
      | "primary"
      | "primary-seconds"
      | "wide-30d"
      | "unbounded"
      | "empty";
  }> {
    const base = {
      pageSize: opts.pageSize,
      teamId: opts.teamId,
      maxPages: opts.maxPages,
    };

    const primary = await this.getAllFilteredUsageEvents({
      ...base,
      startDate: opts.startDate,
      endDate: opts.endDate,
    });
    if ((primary.usageEventsDisplay?.length ?? 0) > 0) {
      return { response: primary, fetchStrategy: "primary" };
    }

    if (opts.startDate > 1e12) {
      const sec = await this.getAllFilteredUsageEvents({
        ...base,
        startDate: Math.floor(opts.startDate / 1000),
        endDate: Math.floor(opts.endDate / 1000),
      });
      if ((sec.usageEventsDisplay?.length ?? 0) > 0) {
        return { response: sec, fetchStrategy: "primary-seconds" };
      }
    }

    const end = Date.now();
    const wide = await this.getAllFilteredUsageEvents({
      ...base,
      startDate: end - 30 * 86400000,
      endDate: end,
    });
    if ((wide.usageEventsDisplay?.length ?? 0) > 0) {
      return { response: wide, fetchStrategy: "wide-30d" };
    }

    const unbounded = await this.getAllFilteredUsageEvents(base);
    if ((unbounded.usageEventsDisplay?.length ?? 0) > 0) {
      return { response: unbounded, fetchStrategy: "unbounded" };
    }

    return { response: primary, fetchStrategy: "empty" };
  }

  /**
   * Newest usage event with no date filter. The dashboard returns newest first,
   * so page 1 is enough to tell whether activity exists outside the chart window.
   * `ok: false` means the request failed; `event: null` means the account has none.
   */
  async peekLatestUsageEvent(): Promise<
    | { ok: true; event: FilteredUsageEvent | null }
    | { ok: false }
  > {
    try {
      const batch = await this.postJson<FilteredUsageEventsResponse>(
        "/api/dashboard/get-filtered-usage-events",
        { page: 1, pageSize: 1 }
      );
      return { ok: true, event: batch.usageEventsDisplay?.[0] ?? null };
    } catch (e) {
      if (e instanceof CursorAuthError) {
        throw e;
      }
      return { ok: false };
    }
  }

  /** Fallback for cycle bounds when usage-summary lacks them. */
  async getCurrentPeriodUsage(): Promise<PeriodUsage | null> {
    try {
      return await this.postJson<PeriodUsage>(
        "/api/dashboard/get-current-period-usage",
        {}
      );
    } catch (e) {
      if (e instanceof CursorAuthError) {
        throw e;
      }
      return null;
    }
  }

  /** Weekly Grok / sand pool when present on the account. */
  async getSandUsageStatus(): Promise<SandUsageStatus | null> {
    try {
      return await this.postJson<SandUsageStatus>(
        "/api/dashboard/get-sand-usage-status",
        {}
      );
    } catch (e) {
      if (e instanceof CursorAuthError) {
        throw e;
      }
      return null;
    }
  }

  /**
   * Prepaid wallet (grok.com/dashboard “Credits available” / monthly spend).
   * Same payload as DashboardService/GetUserPrepaidBilling.
   */
  async getUserPrepaidBilling(): Promise<UserPrepaidBilling | null> {
    try {
      return await this.postJson<UserPrepaidBilling>(
        "/api/dashboard/get-user-prepaid-billing",
        {}
      );
    } catch (e) {
      if (e instanceof CursorAuthError) {
        throw e;
      }
      return null;
    }
  }

  private async getTokenOrThrow(): Promise<string> {
    const token = await this.getToken();
    if (!token?.trim()) {
      throw new CursorAuthError(
        "Could not read your Cursor login. Stay signed in to Cursor, then refresh — or use the manual token fallback."
      );
    }
    return token.trim();
  }

  private cookieHeader(token: string): string {
    // Accept raw value or full Cookie header paste.
    if (token.includes("WorkosCursorSessionToken=")) {
      return token;
    }
    return `WorkosCursorSessionToken=${token}`;
  }

  private async getJson<T>(path: string): Promise<T> {
    const token = await this.getTokenOrThrow();
    const res = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: this.cookieHeader(token),
        "User-Agent": "CursorUsageDashboard/0.1",
      },
    });
    return this.parseResponse<T>(res, path);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getTokenOrThrow();
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: this.cookieHeader(token),
        Origin: "https://cursor.com",
        Referer: "https://cursor.com/dashboard",
        "User-Agent": "CursorUsageDashboard/0.1",
      },
      body: JSON.stringify(body),
    });
    return this.parseResponse<T>(res, path);
  }

  private async parseResponse<T>(res: Response, path: string): Promise<T> {
    if (res.status === 401 || res.status === 403) {
      throw new CursorAuthError();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CursorApiError(
        `Cursor API ${path} failed (${res.status}): ${text.slice(0, 200)}`,
        res.status,
        path
      );
    }
    return (await res.json()) as T;
  }
}

export { TOKEN_SECRET_KEY };
