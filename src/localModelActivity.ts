import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
