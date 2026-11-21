import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import type {
  DashboardData,
  DailyMetricsPoint,
  DailyMetricsSeries,
  WorkspaceStore,
} from "./types";

const STORE_FILE = "workspace-usage.json";
const CACHE_FILE = "last-dashboard.json";
const RAW_CACHE_FILE = "cache/raw-latest.json";
const HISTORY_DIR = "cache/history";
const DAILY_METRICS_FILE = "cache/daily-metrics-series.json";
/** Legacy file from the first Usage-only series; migrated on first load. */
const LEGACY_INCLUDED_USAGE_FILE = "cache/included-usage-series.json";

/** One snapshot file per calendar day; older days are deleted. */
const MAX_HISTORY_DAYS = 14;
/** Hard cap on history directory size (bytes). Oldest days dropped first. */
const MAX_HISTORY_BYTES = 2 * 1024 * 1024;
/** Skip writing raw cache when the slimmed payload would exceed this. */
const MAX_RAW_BYTES = 512 * 1024;
/** Drop closed workspace windows older than this (ms). */
const WINDOW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Orphaned atomic-write temps older than this are deleted. */
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

const emptyStore = (): WorkspaceStore => ({
  version: 1,
  workspaces: {},
  windows: [],
});

/** Raw Cursor / local payloads for a successful refresh (for recovery / re-agg). */
export interface RawDashboardSnapshot {
  savedAt: string;
  me?: unknown;
  summary?: unknown;
  period?: unknown;
  sand?: unknown;
  prepaid?: unknown;
  analytics?: unknown;
  aggregated?: unknown;
  filtered?: unknown;
  localConversations?: unknown;
  localModels?: unknown;
  rangeStartMs?: number;
  rangeEndMs?: number;
  rangeKind?: string;
}

/** How long a workspace-store lock may live before it is treated as orphaned. */
const LOCK_STALE_MS = 15_000;
/** Give up acquiring the lock after this and proceed unlocked (never wedge). */
const LOCK_TIMEOUT_MS = 5_000;

export class LocalStore {
  private readonly dir: string;
  private maintenanceDone = false;
  /** Serializes all JSON writes from this process (one extension host). */
  private writeQueue: Promise<void> = Promise.resolve();
  private tmpCounter = 0;

  constructor(globalStorageUri: vscode.Uri) {
    this.dir = globalStorageUri.fsPath;
  }

  /** Absolute path of the extension’s durable local cache directory. */
  get storageDir(): string {
    return this.dir;
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /**
   * Crash-safe write: write to a sibling `.tmp` file then rename over the
   * target so a mid-write crash cannot truncate a good cache file.
   */
  /** Run `fn` after all previously queued writes settle, success or failure. */
  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /**
   * Cross-process lock (each Cursor window is its own extension host).
   * Best-effort: on timeout the caller proceeds unlocked rather than wedging.
   * Returns the release function.
   */
  private async acquireFileLock(lockPath: string): Promise<() => Promise<void>> {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        const handle = await fs.open(lockPath, "wx");
        await handle.writeFile(`${process.pid} ${new Date().toISOString()}`);
        return async () => {
          await handle.close().catch(() => undefined);
          await fs.unlink(lockPath).catch(() => undefined);
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") {
          throw e;
        }
        try {
          const st = await fs.stat(lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            await fs.unlink(lockPath).catch(() => undefined);
            continue;
          }
        } catch {
          continue; // Lock vanished between open and stat; retry.
        }
        if (Date.now() >= deadline) {
          return async () => undefined;
        }
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
      }
    }
  }

  private async writeJsonAtomic(
    filePath: string,
    value: unknown,
    pretty = false
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${this.tmpCounter++}.tmp`;
    const body = pretty
      ? JSON.stringify(value, null, 2)
      : JSON.stringify(value);
    try {
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, filePath);
    } catch (e) {
      await fs.unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  /** Run once per process: purge orphaned temps and enforce history caps. */
  async runMaintenance(): Promise<void> {
    if (this.maintenanceDone) {
      return;
    }
    this.maintenanceDone = true;
    await this.ensureDir();
    await Promise.all([
      this.cleanupOrphanTemps(),
      this.pruneHistory(),
    ]);
  }

  private async cleanupOrphanTemps(): Promise<void> {
    const cutoff = Date.now() - TMP_MAX_AGE_MS;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      await Promise.all(
        entries.map(async (ent) => {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            await walk(full);
            return;
          }
          if (!ent.name.endsWith(".tmp")) {
            return;
          }
          try {
            const st = await fs.stat(full);
            if (st.mtimeMs < cutoff) {
              await fs.unlink(full);
            }
          } catch {
            // ignore
          }
        })
      );
    };
    await walk(this.dir);
  }

  async loadWorkspaceStore(): Promise<WorkspaceStore> {
    await this.ensureDir();
    void this.runMaintenance();
    try {
      const raw = await fs.readFile(path.join(this.dir, STORE_FILE), "utf8");
      const parsed = JSON.parse(raw) as WorkspaceStore;
      if (parsed?.version !== 1 || !parsed.workspaces) {
        return emptyStore();
      }
      parsed.windows = parsed.windows ?? [];
      return parsed;
    } catch {
      return emptyStore();
    }
  }

  private async writeWorkspaceStoreFile(store: WorkspaceStore): Promise<void> {
    await this.ensureDir();
    pruneClosedWindows(store);
    await this.writeJsonAtomic(path.join(this.dir, STORE_FILE), store, true);
  }

  async saveWorkspaceStore(store: WorkspaceStore): Promise<void> {
    return this.enqueueWrite(async () => {
      const release = await this.acquireFileLock(
        path.join(this.dir, `${STORE_FILE}.lock`)
      );
      try {
        await this.writeWorkspaceStoreFile(store);
      } finally {
        await release();
      }
    });
  }

  /**
   * Load → mutate → save the workspace store as one serialized, locked step,
   * so overlapping refreshes and other Cursor windows cannot lose each
   * other's updates between a separate load and save. The mutator runs
   * synchronously; return `false` to skip saving (nothing changed).
   */
  async updateWorkspaceStore(
    mutator: (store: WorkspaceStore) => boolean | void
  ): Promise<WorkspaceStore> {
    return this.enqueueWrite(async () => {
      const release = await this.acquireFileLock(
        path.join(this.dir, `${STORE_FILE}.lock`)
      );
      try {
        const store = await this.loadWorkspaceStore();
        if (mutator(store) !== false) {
          await this.writeWorkspaceStoreFile(store);
        }
        return store;
      } finally {
        await release();
      }
    });
  }

  async clearWorkspaceStats(): Promise<void> {
    await this.saveWorkspaceStore(emptyStore());
  }

  async loadCachedDashboard(): Promise<DashboardData | undefined> {
    void this.runMaintenance();
    try {
      const raw = await fs.readFile(path.join(this.dir, CACHE_FILE), "utf8");
      return JSON.parse(raw) as DashboardData;
    } catch {
      return this.loadNewestHistoryDashboard();
    }
  }

  private async loadNewestHistoryDashboard(): Promise<DashboardData | undefined> {
    try {
      const histDir = path.join(this.dir, HISTORY_DIR);
      const names = (await fs.readdir(histDir))
        .filter((n) => n.endsWith(".json"))
        .sort();
      if (!names.length) {
        return undefined;
      }
      const raw = await fs.readFile(
        path.join(histDir, names[names.length - 1]),
        "utf8"
      );
      return JSON.parse(raw) as DashboardData;
    } catch {
      return undefined;
    }
  }

  /**
   * Persist the dashboard view model as “latest”, and overwrite today’s
   * history file (at most one file per calendar day).
   */
  async saveCachedDashboard(data: DashboardData): Promise<void> {
    return this.enqueueWrite(async () => {
      await this.ensureDir();
      await this.writeJsonAtomic(path.join(this.dir, CACHE_FILE), data, true);
      await this.writeDailyHistory(data);
    });
  }

  private async writeDailyHistory(data: DashboardData): Promise<void> {
    const day = (data.fetchedAt || new Date().toISOString()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return;
    }
    const histPath = path.join(this.dir, HISTORY_DIR, `${day}.json`);
    try {
      // Compact JSON — history is for recovery, not hand-editing.
      await this.writeJsonAtomic(histPath, data, false);
      await this.pruneHistory();
    } catch {
      // History is best-effort; latest cache already written.
    }
  }

  private async pruneHistory(): Promise<void> {
    const histDir = path.join(this.dir, HISTORY_DIR);
    let names: string[];
    try {
      names = (await fs.readdir(histDir)).filter((n) => n.endsWith(".json"));
    } catch {
      return;
    }

    const dailyRe = /^\d{4}-\d{2}-\d{2}\.json$/;
    // Migrate away from legacy per-refresh filenames (…T12-30-54….json).
    const legacy = names.filter((n) => !dailyRe.test(n));
    if (legacy.length) {
      await Promise.all(
        legacy.map((n) =>
          fs.unlink(path.join(histDir, n)).catch(() => undefined)
        )
      );
      names = names.filter((n) => dailyRe.test(n));
    }

    names.sort();
    const excessDays = names.length - MAX_HISTORY_DAYS;
    if (excessDays > 0) {
      await Promise.all(
        names.slice(0, excessDays).map((n) =>
          fs.unlink(path.join(histDir, n)).catch(() => undefined)
        )
      );
      names = names.slice(excessDays);
    }

    let total = 0;
    const sized: Array<{ name: string; size: number }> = [];
    for (const name of names) {
      try {
        const st = await fs.stat(path.join(histDir, name));
        sized.push({ name, size: st.size });
        total += st.size;
      } catch {
        // ignore missing
      }
    }
    sized.sort((a, b) => a.name.localeCompare(b.name));
    while (total > MAX_HISTORY_BYTES && sized.length > 1) {
      const drop = sized.shift()!;
      total -= drop.size;
      await fs.unlink(path.join(histDir, drop.name)).catch(() => undefined);
    }
  }

  async loadRawSnapshot(): Promise<RawDashboardSnapshot | undefined> {
    try {
      const raw = await fs.readFile(path.join(this.dir, RAW_CACHE_FILE), "utf8");
      return JSON.parse(raw) as RawDashboardSnapshot;
    } catch {
      return undefined;
    }
  }

  /**
   * Durable daily metrics for Trend (included %, local tokens, cumulative spend).
   * Survives the 14-day recovery history prune. Upserts one point per calendar day.
   */
  async loadDailyMetricsSeries(): Promise<DailyMetricsPoint[]> {
    void this.runMaintenance();
    return this.enqueueWrite(async () => this.readOrSeedDailyMetricsSeries());
  }

  /** @deprecated Prefer loadDailyMetricsSeries */
  async loadIncludedUsageSeries(): Promise<DailyMetricsPoint[]> {
    return this.loadDailyMetricsSeries();
  }

  /**
   * Upsert today’s durable metrics and return the full series.
   * Seeds from recovery history (and migrates the legacy included-% file) once.
   */
  async recordDailyMetrics(
    point: DailyMetricsPoint
  ): Promise<DailyMetricsPoint[]> {
    return this.enqueueWrite(async () => {
      const points = await this.readOrSeedDailyMetricsSeries();
      const next = upsertDailyMetricsPoint(points, point);
      await this.writeDailyMetricsSeries(next);
      return next;
    });
  }

  /** @deprecated Prefer recordDailyMetrics */
  async recordIncludedUsage(
    point: DailyMetricsPoint & { pct?: number }
  ): Promise<DailyMetricsPoint[]> {
    const included =
      typeof point.includedPercentUsed === "number"
        ? point.includedPercentUsed
        : typeof point.pct === "number"
          ? point.pct
          : undefined;
    return this.recordDailyMetrics({
      ...point,
      includedPercentUsed: included,
    });
  }

  private async readOrSeedDailyMetricsSeries(): Promise<DailyMetricsPoint[]> {
    const filePath = path.join(this.dir, DAILY_METRICS_FILE);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeDailyMetricsSeries(JSON.parse(raw));
    } catch {
      const fromLegacy = await this.readLegacyIncludedUsageSeries();
      const seeded = await this.seedDailyMetricsFromHistory();
      const merged = mergeDailyMetricsPoints(seeded, fromLegacy);
      if (merged.length) {
        await this.writeDailyMetricsSeries(merged);
      }
      return merged;
    }
  }

  private async writeDailyMetricsSeries(
    points: DailyMetricsPoint[]
  ): Promise<void> {
    await this.ensureDir();
    const body: DailyMetricsSeries = { version: 1, points };
    await this.writeJsonAtomic(
      path.join(this.dir, DAILY_METRICS_FILE),
      body,
      false
    );
  }

  private async readLegacyIncludedUsageSeries(): Promise<DailyMetricsPoint[]> {
    try {
      const raw = await fs.readFile(
        path.join(this.dir, LEGACY_INCLUDED_USAGE_FILE),
        "utf8"
      );
      return normalizeDailyMetricsSeries(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  /** Best-effort bootstrap from existing cache/history/YYYY-MM-DD.json files. */
  private async seedDailyMetricsFromHistory(): Promise<DailyMetricsPoint[]> {
    const histDir = path.join(this.dir, HISTORY_DIR);
    let names: string[];
    try {
      names = (await fs.readdir(histDir))
        .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
        .sort();
    } catch {
      return [];
    }
    const byDay = new Map<string, DailyMetricsPoint>();
    for (const name of names) {
      try {
        const raw = await fs.readFile(path.join(histDir, name), "utf8");
        const data = JSON.parse(raw) as DashboardData;
        const day = name.slice(0, 10);
        const fetchedAt =
          typeof data.fetchedAt === "string" && data.fetchedAt
            ? data.fetchedAt
            : `${day}T00:00:00.000Z`;
        const pct = data.plan?.includedPercentUsed;
        const spend = data.plan?.onDemandUsedCents;
        const dayRow = Array.isArray(data.daily)
          ? data.daily.find((d) => d.date === day)
          : undefined;
        const point: DailyMetricsPoint = {
          day,
          fetchedAt,
          cycleStart: data.plan?.cycleStart,
          cycleEnd: data.plan?.cycleEnd,
        };
        if (typeof pct === "number" && Number.isFinite(pct)) {
          point.includedPercentUsed = pct;
        }
        if (typeof spend === "number" && Number.isFinite(spend)) {
          point.cumulativeSpendCents = spend;
        }
        if (dayRow) {
          if ((dayRow.localEstimatedTokens || 0) > 0) {
            point.localTokens = dayRow.localEstimatedTokens;
          }
          if ((dayRow.tokens || 0) > 0) {
            point.apiTokens = dayRow.tokens;
          }
        }
        if (
          point.includedPercentUsed == null &&
          point.cumulativeSpendCents == null &&
          point.localTokens == null &&
          point.apiTokens == null
        ) {
          continue;
        }
        byDay.set(day, point);
      } catch {
        // skip corrupt history day
      }
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  async saveRawSnapshot(snapshot: RawDashboardSnapshot): Promise<void> {
    return this.enqueueWrite(() => this.writeRawSnapshot(snapshot));
  }

  private async writeRawSnapshot(
    snapshot: RawDashboardSnapshot
  ): Promise<void> {
    await this.ensureDir();
    const slim = slimRawSnapshot(snapshot);
    const body = JSON.stringify(slim);
    if (Buffer.byteLength(body, "utf8") > MAX_RAW_BYTES) {
      // Last resort: drop bulky local arrays too.
      const minimal: RawDashboardSnapshot = {
        savedAt: slim.savedAt,
        me: slim.me,
        summary: slim.summary,
        period: slim.period,
        sand: slim.sand,
        aggregated: slim.aggregated,
        filtered: slim.filtered,
        rangeStartMs: slim.rangeStartMs,
        rangeEndMs: slim.rangeEndMs,
        rangeKind: slim.rangeKind,
      };
      await this.writeJsonAtomic(
        path.join(this.dir, RAW_CACHE_FILE),
        minimal,
        false
      );
      return;
    }
    await this.writeJsonAtomic(path.join(this.dir, RAW_CACHE_FILE), slim, false);
  }
}

function finiteOrUndef(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return undefined;
  }
  return v;
}

function normalizeDailyMetricsSeries(raw: unknown): DailyMetricsPoint[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const points = (raw as DailyMetricsSeries).points;
  if (!Array.isArray(points)) {
    return [];
  }
  const byDay = new Map<string, DailyMetricsPoint>();
  for (const row of points) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const day = typeof row.day === "string" ? row.day.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      continue;
    }
    const legacyPct = finiteOrUndef((row as { pct?: number }).pct);
    const includedPercentUsed =
      finiteOrUndef(row.includedPercentUsed) ?? legacyPct;
    const point: DailyMetricsPoint = {
      day,
      fetchedAt:
        typeof row.fetchedAt === "string" && row.fetchedAt
          ? row.fetchedAt
          : `${day}T00:00:00.000Z`,
      cycleStart:
        typeof row.cycleStart === "string" ? row.cycleStart : undefined,
      cycleEnd: typeof row.cycleEnd === "string" ? row.cycleEnd : undefined,
      includedPercentUsed,
      localTokens: finiteOrUndef(row.localTokens),
      apiTokens: finiteOrUndef(row.apiTokens),
      cumulativeSpendCents: finiteOrUndef(row.cumulativeSpendCents),
    };
    if (
      point.includedPercentUsed == null &&
      point.localTokens == null &&
      point.apiTokens == null &&
      point.cumulativeSpendCents == null
    ) {
      continue;
    }
    byDay.set(day, point);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function mergeDailyMetricsPoints(
  ...lists: DailyMetricsPoint[][]
): DailyMetricsPoint[] {
  let out: DailyMetricsPoint[] = [];
  for (const list of lists) {
    for (const point of list) {
      out = upsertDailyMetricsPoint(out, point);
    }
  }
  return out;
}

function upsertDailyMetricsPoint(
  points: DailyMetricsPoint[],
  point: DailyMetricsPoint
): DailyMetricsPoint[] {
  const day = point.day?.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return points;
  }
  const prev = points.find((p) => p.day === day);
  const nextPoint: DailyMetricsPoint = {
    day,
    fetchedAt: point.fetchedAt || prev?.fetchedAt || new Date().toISOString(),
    cycleStart: point.cycleStart ?? prev?.cycleStart,
    cycleEnd: point.cycleEnd ?? prev?.cycleEnd,
    includedPercentUsed:
      finiteOrUndef(point.includedPercentUsed) ?? prev?.includedPercentUsed,
    localTokens: finiteOrUndef(point.localTokens) ?? prev?.localTokens,
    apiTokens: finiteOrUndef(point.apiTokens) ?? prev?.apiTokens,
    cumulativeSpendCents:
      finiteOrUndef(point.cumulativeSpendCents) ?? prev?.cumulativeSpendCents,
  };
  if (
    nextPoint.includedPercentUsed == null &&
    nextPoint.localTokens == null &&
    nextPoint.apiTokens == null &&
    nextPoint.cumulativeSpendCents == null
  ) {
    return points;
  }
  const next = points.filter((p) => p.day !== day);
  next.push(nextPoint);
  next.sort((a, b) => a.day.localeCompare(b.day));
  return next;
}

/** Keep open windows + recent closed ones; drop old closed sessions. */
function pruneClosedWindows(store: WorkspaceStore): void {
  const cutoff = Date.now() - WINDOW_RETENTION_MS;
  store.windows = (store.windows ?? []).filter((w) => {
    if (!w.endedAt) {
      return true;
    }
    const end = Date.parse(w.endedAt);
    return Number.isFinite(end) && end >= cutoff;
  });
}

/**
 * Drop the bulky filtered event list (view model + aggregates already cover
 * recovery). Keep a count so re-agg tooling knows events existed.
 */
function slimRawSnapshot(snapshot: RawDashboardSnapshot): RawDashboardSnapshot {
  const out: RawDashboardSnapshot = { ...snapshot };
  const filtered = snapshot.filtered;
  if (filtered && typeof filtered === "object") {
    const f = filtered as Record<string, unknown>;
    const events = f.usageEventsDisplay;
    const count = Array.isArray(events)
      ? events.length
      : typeof f.totalUsageEventsCount === "number"
        ? f.totalUsageEventsCount
        : undefined;
    const { usageEventsDisplay: _drop, ...rest } = f;
    out.filtered = {
      ...rest,
      totalUsageEventsCount: count ?? f.totalUsageEventsCount,
      _eventsOmitted: Array.isArray(events),
    };
  }
  return out;
}
