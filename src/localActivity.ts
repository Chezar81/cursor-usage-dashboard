import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  identityFromProjectSlug,
  type ConversationWorkspace,
} from "./conversationWorkspaceMap";
import { dayKeyLocal } from "./dates";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Safety cap for transcript reads so a huge chat cannot stall refresh. */
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const TRANSCRIPT_CHUNK_BYTES = 256 * 1024;

/** mtime+size key for transcript analysis cache (recomputed when file grows). */
const TRANSCRIPT_CACHE_DIR = "cache/transcript-analysis";

interface TranscriptAnalysisCacheFile {
  mtimeMs: number;
  size: number;
  analysis: TranscriptAnalysis;
}

function transcriptCacheKey(transcriptFile: string): string {
  return crypto.createHash("sha256").update(transcriptFile).digest("hex");
}

function readCachedTranscriptAnalysis(
  cacheDir: string | undefined,
  transcriptFile: string,
  st: fs.Stats
): TranscriptAnalysis | undefined {
  if (!cacheDir?.trim()) {
    return undefined;
  }
  const filePath = path.join(
    cacheDir,
    TRANSCRIPT_CACHE_DIR,
    `${transcriptCacheKey(transcriptFile)}.json`
  );
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as TranscriptAnalysisCacheFile;
    if (
      parsed.mtimeMs !== st.mtimeMs ||
      parsed.size !== st.size ||
      !parsed.analysis
    ) {
      return undefined;
    }
    return parsed.analysis;
  } catch {
    return undefined;
  }
}

function writeCachedTranscriptAnalysis(
  cacheDir: string | undefined,
  transcriptFile: string,
  st: fs.Stats,
  analysis: TranscriptAnalysis
): void {
  if (!cacheDir?.trim()) {
    return;
  }
  const dir = path.join(cacheDir, TRANSCRIPT_CACHE_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const finalPath = path.join(dir, `${transcriptCacheKey(transcriptFile)}.json`);
    const tmp = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    const body: TranscriptAnalysisCacheFile = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      analysis,
    };
    fs.writeFileSync(tmp, JSON.stringify(body), "utf8");
    fs.renameSync(tmp, finalPath);
  } catch {
    // cache is best-effort
  }
}

/**
 * Same as `analyzeTranscript`, but reuses a disk cache keyed by absolute path,
 * file mtime, and size when `cacheDir` is set (extension global storage).
 */
export function analyzeTranscriptWithOptionalCache(
  transcriptFile: string | undefined,
  fallbackDayKey: string | undefined,
  cacheDir: string | undefined
): TranscriptAnalysis {
  if (!transcriptFile) {
    return emptyTranscriptAnalysis();
  }
  try {
    const st = fs.statSync(transcriptFile);
    if (!st.isFile() || st.size <= 0) {
      return emptyTranscriptAnalysis();
    }
    if (cacheDir?.trim()) {
      const cached = readCachedTranscriptAnalysis(cacheDir, transcriptFile, st);
      if (cached) {
        return cached;
      }
    }
    const fallback =
      fallbackDayKey || dayKeyLocal(transcriptLastActiveMs(transcriptFile, st.mtimeMs));
    const analysis = analyzeTranscriptInner(transcriptFile, fallback);
    if (cacheDir?.trim()) {
      writeCachedTranscriptAnalysis(cacheDir, transcriptFile, st, analysis);
    }
    return analysis;
  } catch {
    return emptyTranscriptAnalysis();
  }
}

/** One local agent chat discovered under ~/.cursor/projects. */
export interface LocalConversationActivity {
  conversationId: string;
  workspaceId: string;
  displayName: string;
  /** Best-effort last activity (mtime of transcript file or folder). */
  lastActiveMs: number;
  /** Local calendar day for lastActiveMs (YYYY-MM-DD). */
  dayKey: string;
  /**
   * Rough token estimate from visible transcript text (chars ÷ 4).
   * Not billed usage — undercounts cache/tools/system context.
   */
  estimatedTokens: number;
  /**
   * User-turn count; stand-in for Cursor analytics agentRequests when that
   * endpoint lags.
   */
  estimatedRequests: number;
  /**
   * User turns bucketed by local calendar day (from `<timestamp>` stamps,
   * else the chat's last-active day).
   */
  estimatedRequestsByDay: Record<string, number>;
  /**
   * Transcript token estimate split across local days. Chars after a stamped
   * user turn land on that turn's day; unstamped chats use last-active day.
   */
  estimatedTokensByDay: Record<string, number>;
  /** First user message, one line. Empty when the transcript has no user text. */
  title: string;
}

export interface LocalActivityScan {
  conversations: LocalConversationActivity[];
  scannedAt: string;
}

/**
 * Scan local agent transcripts for recent chat activity.
 * Used as a provisional Trend/workspace signal until Cursor's usage API
 * returns matching conversationIds.
 */
export function scanLocalConversationActivity(opts?: {
  /** Only include chats with last activity on/after this instant. */
  sinceMs?: number;
  /**
   * Extension global storage dir — enables transcript analysis cache
   * (skips re-reading unchanged jsonl when mtime+size match).
   */
  cacheDir?: string;
}): LocalActivityScan {
  const conversations: LocalConversationActivity[] = [];
  const projectsRoot = path.join(os.homedir(), ".cursor", "projects");
  if (!fs.existsSync(projectsRoot)) {
    return { conversations, scannedAt: new Date().toISOString() };
  }

  let projectDirs: string[] = [];
  try {
    projectDirs = fs.readdirSync(projectsRoot);
  } catch {
    return { conversations, scannedAt: new Date().toISOString() };
  }

  const sinceMs = opts?.sinceMs;
  const seen = new Set<string>();

  for (const slug of projectDirs) {
    if (slug.startsWith(".")) {
      continue;
    }
    const transcriptsDir = path.join(projectsRoot, slug, "agent-transcripts");
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(transcriptsDir);
    } catch {
      continue;
    }

    const identity: ConversationWorkspace = identityFromProjectSlug(slug);

    for (const name of entries) {
      if (!UUID_RE.test(name) || seen.has(name)) {
        continue;
      }
      const full = path.join(transcriptsDir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) {
        continue;
      }

      const transcriptFile = resolveTranscriptFile(full, name);
      const lastActiveMs = transcriptLastActiveMs(transcriptFile, st.mtimeMs);
      if (sinceMs !== undefined && lastActiveMs < sinceMs) {
        continue;
      }

      seen.add(name);
      const fallbackDay = dayKeyLocal(lastActiveMs);
      const analysis = analyzeTranscriptWithOptionalCache(
        transcriptFile,
        fallbackDay,
        opts?.cacheDir
      );
      conversations.push({
        conversationId: name,
        workspaceId: identity.workspaceId,
        displayName: identity.displayName,
        lastActiveMs,
        dayKey: fallbackDay,
        estimatedTokens: analysis.estimatedTokens,
        estimatedRequests: analysis.estimatedRequests,
        estimatedRequestsByDay: analysis.estimatedRequestsByDay,
        estimatedTokensByDay: analysis.estimatedTokensByDay,
        title: transcriptTitle(transcriptFile),
      });
    }
  }

  conversations.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
  return { conversations, scannedAt: new Date().toISOString() };
}

function resolveTranscriptFile(
  dir: string,
  conversationId: string
): string | undefined {
  const candidates = [
    path.join(dir, `${conversationId}.jsonl`),
    path.join(dir, "transcript.jsonl"),
  ];
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) {
        return file;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function transcriptLastActiveMs(
  transcriptFile: string | undefined,
  dirMtimeMs: number
): number {
  let best = dirMtimeMs;
  if (transcriptFile) {
    try {
      const st = fs.statSync(transcriptFile);
      if (st.isFile() && st.mtimeMs > best) {
        best = st.mtimeMs;
      }
    } catch {
      // ignore
    }
  }
  return best;
}

export interface TranscriptAnalysis {
  estimatedTokens: number;
  estimatedRequests: number;
  estimatedRequestsByDay: Record<string, number>;
  estimatedTokensByDay: Record<string, number>;
}

function emptyTranscriptAnalysis(): TranscriptAnalysis {
  return {
    estimatedTokens: 0,
    estimatedRequests: 0,
    estimatedRequestsByDay: {},
    estimatedTokensByDay: {},
  };
}

/**
 * Rough billed-token stand-in from transcript text (chars ÷ 4), plus
 * day-bucketed user-turn counts. Streams the whole transcript (up to the
 * safety cap). Returns zeros when the file is missing or unreadable.
 */
export function analyzeTranscript(
  transcriptFile: string | undefined,
  fallbackDayKey?: string
): TranscriptAnalysis {
  if (!transcriptFile) {
    return emptyTranscriptAnalysis();
  }
  try {
    const st = fs.statSync(transcriptFile);
    if (!st.isFile() || st.size <= 0) {
      return emptyTranscriptAnalysis();
    }
    const fallback =
      fallbackDayKey ||
      dayKeyLocal(transcriptLastActiveMs(transcriptFile, st.mtimeMs));
    return analyzeTranscriptInner(transcriptFile, fallback);
  } catch {
    return emptyTranscriptAnalysis();
  }
}

function analyzeTranscriptInner(
  transcriptFile: string,
  fallback: string
): TranscriptAnalysis {
  try {
    const st = fs.statSync(transcriptFile);
    if (!st.isFile() || st.size <= 0) {
      return emptyTranscriptAnalysis();
    }
    const fd = fs.openSync(transcriptFile, "r");
    try {
      const limit = Math.min(st.size, MAX_TRANSCRIPT_BYTES);
      const chunk = Buffer.alloc(TRANSCRIPT_CHUNK_BYTES);
      let leftover = Buffer.alloc(0);
      let read = 0;
      let chars = 0;
      let userTurns = 0;
      const reqByDay: Record<string, number> = {};
      const charByDay: Record<string, number> = {};
      let activeDay = fallback;
      const absorb = (raw: string) => {
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          try {
            const parsed = JSON.parse(trimmed) as unknown;
            const lineChars = countMessageChars(parsed);
            chars += lineChars;
            if (isUserTurnRecord(parsed)) {
              const text = userTextFromRecord(parsed) ?? "";
              const ms = parseTranscriptTimestamp(text);
              activeDay = ms !== undefined ? dayKeyLocal(ms) : fallback;
              reqByDay[activeDay] = (reqByDay[activeDay] || 0) + 1;
              userTurns += 1;
            }
            charByDay[activeDay] = (charByDay[activeDay] || 0) + lineChars;
          } catch {
            chars += trimmed.length;
            charByDay[activeDay] = (charByDay[activeDay] || 0) + trimmed.length;
          }
        }
      };
      while (read < limit) {
        const n = fs.readSync(
          fd,
          chunk,
          0,
          Math.min(chunk.length, limit - read),
          read
        );
        if (n <= 0) {
          break;
        }
        read += n;
        // 0x0A never appears inside a multi-byte UTF-8 sequence, so
        // splitting the byte stream at the last newline is safe.
        const data =
          leftover.length > 0
            ? Buffer.concat([leftover, chunk.subarray(0, n)])
            : Buffer.from(chunk.subarray(0, n));
        const cut = data.lastIndexOf(0x0a);
        if (cut < 0) {
          leftover = data;
          continue;
        }
        absorb(data.subarray(0, cut).toString("utf8"));
        leftover = Buffer.from(data.subarray(cut + 1));
      }
      if (leftover.length > 0) {
        absorb(leftover.toString("utf8"));
      }
      const tokensByDay: Record<string, number> = {};
      for (const [day, dayChars] of Object.entries(charByDay)) {
        if (dayChars > 0) {
          tokensByDay[day] = Math.max(1, Math.round(dayChars / 4));
        }
      }
      return {
        estimatedTokens: chars > 0 ? Math.max(1, Math.round(chars / 4)) : 0,
        estimatedRequests: userTurns,
        estimatedRequestsByDay: reqByDay,
        estimatedTokensByDay: tokensByDay,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return emptyTranscriptAnalysis();
  }
}

/** Token-only helper kept for tests and call sites that do not need requests. */
export function estimateTranscriptTokens(
  transcriptFile: string | undefined
): number {
  return analyzeTranscript(transcriptFile).estimatedTokens;
}

/**
 * Parse a Cursor `<timestamp>…</timestamp>` stamp into epoch ms.
 * Returns undefined when the stamp is missing or unparseable.
 */
export function parseTranscriptTimestamp(raw: string): number | undefined {
  const tagged = raw.match(/<timestamp>\s*([^<]+?)\s*<\/timestamp>/i);
  if (!tagged) {
    return undefined;
  }
  let body = tagged[1].trim();
  body = body.replace(/^[A-Za-z]+,\s*/, "");
  body = body.replace(
    /\(UTC([+-])(\d{1,2})(?::(\d{2}))?\)/i,
    (_m, sign: string, hour: string, minute?: string) => {
      const hh = String(Math.abs(parseInt(hour, 10))).padStart(2, "0");
      const mm = minute ?? "00";
      return `${sign}${hh}:${mm}`;
    }
  );
  const ms = Date.parse(body);
  return Number.isFinite(ms) ? ms : undefined;
}

/** How much of a transcript to scan for the opening user message. */
const TITLE_READ_BYTES = 256 * 1024;
const MAX_TITLE_CHARS = 120;

/**
 * First user message as a single-line title.
 * Empty when the file is missing or has no user text.
 */
export function transcriptTitle(transcriptFile: string | undefined): string {
  if (!transcriptFile) {
    return "";
  }
  try {
    const raw = readTranscriptHead(transcriptFile, TITLE_READ_BYTES);
    return titleFromTranscriptJsonl(raw);
  } catch {
    return "";
  }
}

/** Pull a short title from the first user turn in a JSONL transcript. */
export function titleFromTranscriptJsonl(raw: string): string {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const text = userTextFromRecord(parsed);
    if (!text) {
      continue;
    }
    const title = titleFromUserText(text);
    if (title) {
      return title;
    }
  }
  return "";
}

export function titleFromUserText(text: string): string {
  const tagged = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  let body = tagged ? tagged[1] : text;
  body = body.replace(/<[^>\n]+>/g, " ");
  body = body.replace(/\s+/g, " ").trim();
  if (!body) {
    return "";
  }
  if (body.length <= MAX_TITLE_CHARS) {
    return body;
  }
  return body.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + "…";
}

function readTranscriptHead(file: string, maxBytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size <= 0) {
      return "";
    }
    const toRead = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(toRead);
    const n = fs.readSync(fd, buf, 0, toRead, 0);
    let text = buf.toString("utf8", 0, n);
    if (n < st.size) {
      const cut = text.lastIndexOf("\n");
      if (cut > 0) {
        text = text.slice(0, cut);
      }
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function userTextFromRecord(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (obj.role === "user") {
    const text = textFromContent(obj.message ?? obj);
    return text || undefined;
  }
  const message = obj.message;
  if (message && typeof message === "object") {
    const nested = message as Record<string, unknown>;
    if (nested.role === "user") {
      const text = textFromContent(nested);
      return text || undefined;
    }
  }
  return undefined;
}

function isUserTurnRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.role === "user") {
    return true;
  }
  const message = obj.message;
  if (message && typeof message === "object") {
    return (message as Record<string, unknown>).role === "user";
  }
  return false;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => textFromContent(part))
      .filter((part) => part.length > 0)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") {
      return obj.text;
    }
    if ("content" in obj) {
      return textFromContent(obj.content);
    }
  }
  return "";
}

export function estimateTokensFromJsonl(raw: string): number {
  const chars = countJsonlChars(raw);
  if (chars <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(chars / 4));
}

function countJsonlChars(raw: string): number {
  let chars = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      chars += countMessageChars(JSON.parse(trimmed));
    } catch {
      chars += trimmed.length;
    }
  }
  return chars;
}

function countMessageChars(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === "string") {
    return value.length;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    let n = 0;
    for (const item of value) {
      n += countMessageChars(item);
    }
    return n;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Prefer known text-bearing fields; fall back to shallow string values.
    let n = 0;
    for (const key of [
      "text",
      "content",
      "thinking",
      "message",
      "query",
      "result",
      "output",
      "input",
      "arguments",
    ]) {
      if (key in obj) {
        n += countMessageChars(obj[key]);
      }
    }
    if (n > 0) {
      return n;
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "string") {
        n += v.length;
      }
    }
    return n;
  }
  return 0;
}

/** conversationId set from usage events (API is authoritative once present). */
export function apiConversationIds(
  events: Array<{ conversationId?: string; [key: string]: unknown }>
): Set<string> {
  const ids = new Set<string>();
  for (const ev of events) {
    const id = extractConversationId(ev);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

export function extractConversationId(ev: {
  conversationId?: string;
  [key: string]: unknown;
}): string | undefined {
  for (const key of [
    "conversationId",
    "composerId",
    "chatId",
    "composer_id",
    "conversation_id",
  ] as const) {
    const v = ev[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}
