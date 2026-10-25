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

/** Cap transcript reads so a huge chat cannot stall refresh. */
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

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
      conversations.push({
        conversationId: name,
        workspaceId: identity.workspaceId,
        displayName: identity.displayName,
        lastActiveMs,
        dayKey: dayKeyLocal(lastActiveMs),
        estimatedTokens: estimateTranscriptTokens(transcriptFile),
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

/**
 * Rough billed-token stand-in from transcript text (chars ÷ 4).
 * Returns 0 when the file is missing or unreadable.
 */
export function estimateTranscriptTokens(
  transcriptFile: string | undefined
): number {
  if (!transcriptFile) {
    return 0;
  }
  try {
    const st = fs.statSync(transcriptFile);
    if (!st.isFile() || st.size <= 0) {
      return 0;
    }
    const fd = fs.openSync(transcriptFile, "r");
    try {
      const toRead = Math.min(st.size, MAX_TRANSCRIPT_BYTES);
      const buf = Buffer.alloc(toRead);
      const n = fs.readSync(fd, buf, 0, toRead, 0);
      return estimateTokensFromJsonl(buf.toString("utf8", 0, n));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 0;
  }
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
  if (obj.role !== "user") {
    return undefined;
  }
  const text = textFromContent(obj.message ?? obj);
  return text || undefined;
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
  if (chars <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(chars / 4));
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
