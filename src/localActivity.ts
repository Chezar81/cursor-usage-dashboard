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
