import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findStateDbPath } from "./localAuth";

/** Local model hint from Cursor's AI code-tracking DB (per conversation). */
export interface LocalModelActivity {
  conversationId: string;
  /** Raw model label from tracking (e.g. grok-4.6, default). */
  model: string;
  lastActiveMs: number;
}

/**
 * Read per-conversation model labels from ~/.cursor/ai-tracking.
 * Used as a provisional Models signal until the usage API publishes events
 * for the same conversationId.
 */
export function scanLocalModelActivity(opts?: {
  sinceMs?: number;
  untilMs?: number;
}): LocalModelActivity[] {
  const dbPath = findAiTrackingDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return [];
  }

  const sinceMs = opts?.sinceMs ?? 0;
  const untilMs = opts?.untilMs ?? Date.now() + 60_000;
  const rows = readTrackingRows(dbPath, sinceMs, untilMs);
  return pickLatestModelPerConversation(rows);
}

function findAiTrackingDbPath(): string | undefined {
  const candidate = path.join(
    os.homedir(),
    ".cursor",
    "ai-tracking",
    "ai-code-tracking.db"
  );
  return fs.existsSync(candidate) ? candidate : undefined;
}

interface RawRow {
  conversationId: string;
  model: string;
  ts: number;
}

function readTrackingRows(
  dbPath: string,
  sinceMs: number,
  untilMs: number
): RawRow[] {
  // Direct read first; the copy below is only for a locked DB.
  const direct =
    tryNodeSqliteRows(dbPath, sinceMs, untilMs) ??
    tryPythonSqliteRows(dbPath, sinceMs, untilMs) ??
    trySqliteCliRows(dbPath, sinceMs, untilMs);
  if (direct !== undefined) {
    return direct;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-usage-models-"));
  const tmpDb = path.join(tmpDir, "ai-code-tracking.db");
  try {
    fs.copyFileSync(dbPath, tmpDb);
    for (const suffix of ["-wal", "-shm"]) {
      const side = dbPath + suffix;
      if (fs.existsSync(side)) {
        try {
          fs.copyFileSync(side, tmpDb + suffix);
        } catch {
          // ignore
        }
      }
    }

    return (
      tryNodeSqliteRows(tmpDb, sinceMs, untilMs) ??
      tryPythonSqliteRows(tmpDb, sinceMs, untilMs) ??
      trySqliteCliRows(tmpDb, sinceMs, untilMs) ??
      []
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function tryNodeSqliteRows(
  dbPath: string,
  sinceMs: number,
  untilMs: number
): RawRow[] | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        opts?: { readOnly?: boolean }
      ) => {
        prepare: (sql: string) => {
          all: (...params: unknown[]) => Array<Record<string, unknown>>;
        };
        close: () => void;
      };
    };
    const db = new mod.DatabaseSync(dbPath, { readOnly: true });
    try {
      const sql =
        "SELECT conversationId, model, CAST(timestamp AS INTEGER) AS ts " +
        "FROM ai_code_hashes " +
        "WHERE conversationId IS NOT NULL AND conversationId != '' " +
        "AND CAST(timestamp AS INTEGER) >= ? AND CAST(timestamp AS INTEGER) <= ?";
      const rows = db.prepare(sql).all(sinceMs, untilMs);
      return normalizeRows(rows);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function tryPythonSqliteRows(
  dbPath: string,
  sinceMs: number,
  untilMs: number
): RawRow[] | undefined {
  const script = [
    "import sqlite3,sys,json",
    "conn=sqlite3.connect(sys.argv[1])",
    "cur=conn.cursor()",
    "cur.execute('SELECT conversationId, model, CAST(timestamp AS INTEGER) FROM ai_code_hashes WHERE conversationId IS NOT NULL AND conversationId != \"\" AND CAST(timestamp AS INTEGER) >= ? AND CAST(timestamp AS INTEGER) <= ?', (int(sys.argv[2]), int(sys.argv[3])))",
    "rows=[{'conversationId':r[0],'model':r[1],'ts':r[2]} for r in cur.fetchall()]",
    "sys.stdout.write(json.dumps(rows))",
  ].join(";");

  for (const bin of ["python3", "python", "py"]) {
    try {
      const stdout = execFileSync(
        bin,
        ["-c", script, dbPath, String(sinceMs), String(untilMs)],
        { timeout: 8000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }
      );
      const parsed = JSON.parse(String(stdout || "[]")) as unknown;
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      return normalizeRows(parsed as Array<Record<string, unknown>>);
    } catch {
      // try next
    }
  }
  return undefined;
}

function trySqliteCliRows(
  dbPath: string,
  sinceMs: number,
  untilMs: number
): RawRow[] | undefined {
  try {
    const sql =
      "SELECT conversationId || char(9) || IFNULL(model,'') || char(9) || CAST(timestamp AS INTEGER) " +
      "FROM ai_code_hashes " +
      `WHERE conversationId IS NOT NULL AND conversationId != '' ` +
      `AND CAST(timestamp AS INTEGER) >= ${Number(sinceMs)} ` +
      `AND CAST(timestamp AS INTEGER) <= ${Number(untilMs)};`;
    const stdout = execFileSync("sqlite3", [dbPath, sql], {
      timeout: 8000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
    });
    const rows: RawRow[] = [];
    for (const line of String(stdout || "").split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const [conversationId, model, tsRaw] = line.split("\t");
      const ts = Number(tsRaw);
      if (!conversationId || !Number.isFinite(ts)) {
        continue;
      }
      rows.push({
        conversationId: conversationId.trim(),
        model: (model || "").trim() || "default",
        ts,
      });
    }
    return rows;
  } catch {
    return undefined;
  }
}

function normalizeRows(rows: Array<Record<string, unknown>>): RawRow[] {
  const out: RawRow[] = [];
  for (const row of rows) {
    const conversationId =
      typeof row.conversationId === "string" ? row.conversationId.trim() : "";
    if (!conversationId) {
      continue;
    }
    const modelRaw = row.model;
    const model =
      typeof modelRaw === "string" && modelRaw.trim()
        ? modelRaw.trim()
        : "default";
    const ts = Number(row.ts);
    if (!Number.isFinite(ts)) {
      continue;
    }
    // Cursor stores ms; guard against accidental seconds.
    const ms = ts < 1e12 ? ts * 1000 : ts;
    out.push({ conversationId, model, ts: ms });
  }
  return out;
}

/**
 * Prefer the most recent non-"default" model for a conversation; fall back to
 * whatever was last recorded (often "default" when Cursor did not label it).
 */
function pickLatestModelPerConversation(rows: RawRow[]): LocalModelActivity[] {
  const best = new Map<
    string,
    { model: string; lastActiveMs: number; preferScore: number }
  >();

  for (const row of rows) {
    const preferScore = row.model.toLowerCase() === "default" ? 0 : 1;
    const prev = best.get(row.conversationId);
    if (!prev) {
      best.set(row.conversationId, {
        model: row.model,
        lastActiveMs: row.ts,
        preferScore,
      });
      continue;
    }
    // Newer non-default beats older; same preferScore → newer wins.
    if (
      preferScore > prev.preferScore ||
      (preferScore === prev.preferScore && row.ts >= prev.lastActiveMs)
    ) {
      best.set(row.conversationId, {
        model: row.model,
        lastActiveMs: Math.max(prev.lastActiveMs, row.ts),
        preferScore,
      });
    } else {
      prev.lastActiveMs = Math.max(prev.lastActiveMs, row.ts);
    }
  }

  return [...best.entries()]
    .map(([conversationId, v]) => ({
      conversationId,
      model: v.model,
      lastActiveMs: v.lastActiveMs,
    }))
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs);
}

const COMPOSER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Model label from a composerData `modelConfig` (state.vscdb).
 * The picker value wins; `selectedModels` is the fallback for configs that
 * only carry the selection list. "default" means the Auto picker.
 */
export function modelFromComposerConfig(modelConfig: unknown): string {
  if (!modelConfig || typeof modelConfig !== "object") {
    return "default";
  }
  const cfg = modelConfig as {
    modelName?: unknown;
    selectedModels?: unknown;
  };
  if (typeof cfg.modelName === "string" && cfg.modelName.trim()) {
    return cfg.modelName.trim();
  }
  if (Array.isArray(cfg.selectedModels)) {
    for (const sel of cfg.selectedModels) {
      const id = (sel as { modelId?: unknown } | null)?.modelId;
      if (typeof id === "string" && id.trim()) {
        return id.trim();
      }
    }
  }
  return "default";
}

function isGenericModel(model: string): boolean {
  const t = model.trim().toLowerCase();
  return t === "" || t === "default" || t === "unknown" || t === "auto";
}

/**
 * Merge model hints from several local sources (AI code-tracking DB,
 * composerData, …). An explicit model always beats a generic "default",
 * regardless of source; within the same class the newest activity wins.
 */
export function mergeLocalModelActivity(
  sources: LocalModelActivity[][]
): LocalModelActivity[] {
  const best = new Map<string, LocalModelActivity>();
  for (const source of sources) {
    for (const row of source) {
      const prev = best.get(row.conversationId);
      if (!prev) {
        best.set(row.conversationId, row);
        continue;
      }
      const prevGeneric = isGenericModel(prev.model);
      const rowGeneric = isGenericModel(row.model);
      if (prevGeneric && !rowGeneric) {
        best.set(row.conversationId, {
          ...row,
          lastActiveMs: Math.max(prev.lastActiveMs, row.lastActiveMs),
        });
      } else if (
        prevGeneric === rowGeneric &&
        row.lastActiveMs >= prev.lastActiveMs
      ) {
        best.set(row.conversationId, row);
      } else {
        prev.lastActiveMs = Math.max(prev.lastActiveMs, row.lastActiveMs);
      }
    }
  }
  return [...best.values()].sort((a, b) => b.lastActiveMs - a.lastActiveMs);
}

/**
 * Per-conversation model from Cursor's composerData in state.vscdb.
 * Covers every chat (86+ composers), unlike the AI code-tracking DB, which
 * only lists chats that produced tracked code hashes. `lastActiveMs` is the
 * composer creation time — transcript activity refines the day elsewhere.
 */
export function scanComposerModelActivity(): LocalModelActivity[] {
  const dbPath = findStateDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return [];
  }
  const rows =
    tryPythonComposerRows(dbPath) ?? tryNodeComposerRows(dbPath) ?? [];
  const out: LocalModelActivity[] = [];
  for (const row of rows) {
    if (!COMPOSER_UUID_RE.test(row.conversationId)) {
      continue;
    }
    out.push(row);
  }
  return out.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
}

function tryPythonComposerRows(
  dbPath: string
): LocalModelActivity[] | undefined {
  // Extract the small fields inside Python so multi-MB composerData values
  // never cross the process boundary.
  const script = [
    "import sqlite3,sys,json",
    "conn=sqlite3.connect(sys.argv[1])",
    "out=[]",
    "for k,v in conn.execute(\"SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'\"):",
    "    try: d=json.loads(v.decode('utf-8','replace') if isinstance(v,bytes) else v)",
    "    except Exception: continue",
    "    mc=d.get('modelConfig') or {}",
    "    model=(mc.get('modelName') or '').strip()",
    "    if not model:",
    "        for s in (mc.get('selectedModels') or []):",
    "            mid=(s or {}).get('modelId')",
    "            if mid: model=str(mid).strip(); break",
    "    out.append({'conversationId':str(d.get('composerId') or ''),'model':model or 'default','ts':d.get('createdAt') or 0})",
    "sys.stdout.write(json.dumps(out))",
  ].join("\n");

  for (const bin of ["python3", "python", "py"]) {
    try {
      const stdout = execFileSync(bin, ["-c", script, dbPath], {
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      });
      const parsed = JSON.parse(String(stdout || "[]")) as Array<{
        conversationId?: unknown;
        model?: unknown;
        ts?: unknown;
      }>;
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      return parsed
        .map((r) => ({
          conversationId:
            typeof r.conversationId === "string" ? r.conversationId.trim() : "",
          model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : "default",
          lastActiveMs: Number(r.ts) || 0,
        }))
        .filter((r) => r.conversationId);
    } catch {
      // try next interpreter
    }
  }
  return undefined;
}

function tryNodeComposerRows(
  dbPath: string
): LocalModelActivity[] | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        opts?: { readOnly?: boolean }
      ) => {
        prepare: (sql: string) => {
          all: (...params: unknown[]) => Array<Record<string, unknown>>;
        };
        close: () => void;
      };
    };
    const db = new mod.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
        )
        .all();
      const out: LocalModelActivity[] = [];
      for (const row of rows) {
        const raw =
          typeof row.value === "string"
            ? row.value
            : Buffer.isBuffer(row.value)
              ? row.value.toString("utf8")
              : "";
        if (!raw) {
          continue;
        }
        let data: {
          composerId?: unknown;
          modelConfig?: unknown;
          createdAt?: unknown;
        };
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          continue;
        }
        const conversationId =
          typeof data.composerId === "string" ? data.composerId.trim() : "";
        if (!conversationId) {
          continue;
        }
        out.push({
          conversationId,
          model: modelFromComposerConfig(data.modelConfig),
          lastActiveMs: Number(data.createdAt) || 0,
        });
      }
      return out;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** Display label for local tracking models. */
export function formatLocalModelLabel(raw: string): string {
  const t = raw.trim();
  if (!t || t.toLowerCase() === "default") {
    // Cursor stores Auto picker as "default"; exact routed model only appears in usage API.
    return "Auto (Default)";
  }
  if (t.toLowerCase() === "unknown") {
    return "Unknown";
  }
  return t;
}
