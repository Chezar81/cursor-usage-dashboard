import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import type { DashboardData, WorkspaceStore } from "./types";

const STORE_FILE = "workspace-usage.json";
const CACHE_FILE = "last-dashboard.json";
const RAW_CACHE_FILE = "cache/raw-latest.json";
const HISTORY_DIR = "cache/history";
/** Keep enough history to cover several billing cycles without unbounded growth. */
const MAX_HISTORY_FILES = 60;

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
  aggregated?: unknown;
  filtered?: unknown;
  localConversations?: unknown;
  localModels?: unknown;
  rangeStartMs?: number;
  rangeEndMs?: number;
  rangeKind?: string;
}

export class LocalStore {
  private readonly dir: string;

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
   * Crash-safe write: write to a sibling `.tmp` file, fsync, then rename over
   * the target so a mid-write crash cannot truncate a good cache file.
   */
  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const body = JSON.stringify(value, null, 2);
    try {
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, filePath);
    } catch (e) {
      await fs.unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  async loadWorkspaceStore(): Promise<WorkspaceStore> {
    await this.ensureDir();
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

  async saveWorkspaceStore(store: WorkspaceStore): Promise<void> {
    await this.ensureDir();
    await this.writeJsonAtomic(path.join(this.dir, STORE_FILE), store);
  }

  async clearWorkspaceStats(): Promise<void> {
    await this.saveWorkspaceStore(emptyStore());
  }

  async loadCachedDashboard(): Promise<DashboardData | undefined> {
    try {
      const raw = await fs.readFile(path.join(this.dir, CACHE_FILE), "utf8");
      return JSON.parse(raw) as DashboardData;
    } catch {
      // Fall back to newest history file if the primary cache is missing/corrupt.
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
   * Persist the dashboard view model as the “latest” cache and append a
   * timestamped history copy so a later overwrite cannot erase prior data.
   */
  async saveCachedDashboard(data: DashboardData): Promise<void> {
    await this.ensureDir();
    await this.writeJsonAtomic(path.join(this.dir, CACHE_FILE), data);
    await this.appendHistory(data);
  }

  private async appendHistory(data: DashboardData): Promise<void> {
    const stamp = (data.fetchedAt || new Date().toISOString())
      .replace(/[:.]/g, "-")
      .replace(/Z$/, "Z");
    const histPath = path.join(this.dir, HISTORY_DIR, `${stamp}.json`);
    try {
      await this.writeJsonAtomic(histPath, data);
      await this.pruneHistory();
    } catch {
      // History is best-effort; latest cache already written.
    }
  }

  private async pruneHistory(): Promise<void> {
    const histDir = path.join(this.dir, HISTORY_DIR);
    let names: string[];
    try {
      names = (await fs.readdir(histDir))
        .filter((n) => n.endsWith(".json"))
        .sort();
    } catch {
      return;
    }
    const excess = names.length - MAX_HISTORY_FILES;
    if (excess <= 0) {
      return;
    }
    await Promise.all(
      names.slice(0, excess).map((n) =>
        fs.unlink(path.join(histDir, n)).catch(() => undefined)
      )
    );
  }

  async loadRawSnapshot(): Promise<RawDashboardSnapshot | undefined> {
    try {
      const raw = await fs.readFile(path.join(this.dir, RAW_CACHE_FILE), "utf8");
      return JSON.parse(raw) as RawDashboardSnapshot;
    } catch {
      return undefined;
    }
  }

  async saveRawSnapshot(snapshot: RawDashboardSnapshot): Promise<void> {
    await this.ensureDir();
    await this.writeJsonAtomic(path.join(this.dir, RAW_CACHE_FILE), snapshot);
  }
}
