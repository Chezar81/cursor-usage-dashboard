import type {
  AggregatedUsageEventsResponse,
  AuthMe,
  FilteredUsageEventsResponse,
  PeriodUsage,
  SandUsageStatus,
  UsageSummary,
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
    startDate: number;
    endDate: number;
    page?: number;
    pageSize?: number;
    teamId?: number;
  }): Promise<FilteredUsageEventsResponse> {
    return this.postJson<FilteredUsageEventsResponse>(
      "/api/dashboard/get-filtered-usage-events",
      {
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? 500,
        teamId: opts.teamId ?? 0,
      }
    );
  }

  /** Fetch every page of filtered usage events for the range (cap pages for safety). */
  async getAllFilteredUsageEvents(opts: {
    startDate: number;
    endDate: number;
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
