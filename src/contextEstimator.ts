import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { findStateDbPath } from "./localAuth";
import { estimateTranscriptTokens } from "./localActivity";
import type { ContextUsageCategory, ContextUsageView } from "./types";

/** Rough chars→tokens; good enough for local file estimates. */
const CHARS_PER_TOKEN = 4;

/** Typical Cursor agent baselines when we cannot read live tray data. */
const BASELINE = {
  systemPrompt: 470,
  toolDefinitions: 3700,
  subagentDefinitions: 1200,
  windowTokens: 256_000,
} as const;

const CATEGORY_META: Array<{
  id: ContextUsageCategory["id"];
  label: string;
  color: string;
}> = [
  { id: "systemPrompt", label: "System prompt", color: "#8b8b8b" },
  { id: "toolDefinitions", label: "Tool definitions", color: "#9b7bd4" },
  { id: "rules", label: "Rules", color: "#3d6b4f" },
  { id: "skills", label: "Skills", color: "#a67c52" },
  { id: "mcp", label: "MCP & dynamic tools", color: "#c44d9a" },
  { id: "subagents", label: "Subagent definitions", color: "#4a90d9" },
  { id: "conversation", label: "Conversation", color: "#e85d4c" },
];

/** Map Cursor tray category ids → dashboard ids. */
const LIVE_CATEGORY_MAP: Record<string, ContextUsageCategory["id"]> = {
  system_prompt: "systemPrompt",
  tools: "toolDefinitions",
  rules: "rules",
  skills: "skills",
  mcp: "mcp",
  subagents: "subagents",
  conversation: "conversation",
  // Fold summarized history into Conversation (same tray bucket visually).
  summarized_conversation: "conversation",
};

interface LiveComposerContext {
  composerId: string;
  lastUpdatedAt: number;
  percentFull: number;
  usedTokens: number;
  windowTokens: number;
  tokens: Record<ContextUsageCategory["id"], number>;
}

/**
 * Prefer Cursor's live tray numbers from local composerData
 * (`promptTokenBreakdown` in state.vscdb). Fall back to file estimates.
 */
export async function estimateContextUsage(
  workspaceFolders?: readonly vscode.WorkspaceFolder[]
): Promise<ContextUsageView> {
  const folders = workspaceFolders ?? vscode.workspace.workspaceFolders ?? [];
  const roots = folders.map((f) => f.uri.fsPath);

  const live = readLiveContextUsage(roots);
  if (live) {
    const categories: ContextUsageCategory[] = CATEGORY_META.map((m) => ({
      id: m.id,
      label: m.label,
      tokens: Math.max(0, Math.round(live.tokens[m.id] || 0)),
      color: m.color,
    }));
    return {
      percentFull: live.percentFull,
      usedTokens: live.usedTokens,
      windowTokens: live.windowTokens,
      categories,
      estimated: false,
      note: "From Cursor's local composer context tray (same source as the chat Context Usage popup).",
    };
  }

  return estimateFromFiles(roots);
}

export function emptyContextUsage(): ContextUsageView {
  return {
    percentFull: 0,
    usedTokens: 0,
    windowTokens: BASELINE.windowTokens,
    categories: CATEGORY_META.map((m) => ({
      id: m.id,
      label: m.label,
      tokens: 0,
      color: m.color,
    })),
    estimated: true,
  };
}

/** True when a context-only poll would not change the dashboard box. */
export function contextUsageEqual(
  a: ContextUsageView,
  b: ContextUsageView
): boolean {
  if (a.estimated !== b.estimated) {
    return false;
  }
  if (a.usedTokens !== b.usedTokens || a.windowTokens !== b.windowTokens) {
    return false;
  }
  if (Math.round(a.percentFull) !== Math.round(b.percentFull)) {
    return false;
  }
  if (a.categories.length !== b.categories.length) {
    return false;
  }
  for (let i = 0; i < a.categories.length; i++) {
    const ca = a.categories[i];
    const cb = b.categories[i];
    if (ca.id !== cb.id || ca.tokens !== cb.tokens) {
      return false;
    }
  }
  return true;
}

function estimateFromFiles(roots: string[]): ContextUsageView {
  const rules = estimateRules(roots);
  const skills = estimateSkills(roots);
  const mcp = estimateMcp(roots);
  const conversation = estimateConversation(roots);

  const tokens: Record<ContextUsageCategory["id"], number> = {
    systemPrompt: BASELINE.systemPrompt,
    toolDefinitions: BASELINE.toolDefinitions,
    rules,
    skills,
    mcp,
    subagents: BASELINE.subagentDefinitions,
    conversation,
  };

  const categories: ContextUsageCategory[] = CATEGORY_META.map((m) => ({
    id: m.id,
    label: m.label,
    tokens: Math.max(0, Math.round(tokens[m.id])),
    color: m.color,
  }));

  const usedTokens = categories.reduce((s, c) => s + c.tokens, 0);
  const windowTokens = BASELINE.windowTokens;
  const percentFull =
    windowTokens > 0 ? Math.min(100, (usedTokens / windowTokens) * 100) : 0;

  return {
    percentFull,
    usedTokens,
    windowTokens,
    categories,
    estimated: true,
    note: "Estimated from local rules, skills, MCP catalogs, and the latest agent transcript — live composer tray data was unavailable.",
  };
}

/**
 * Read promptTokenBreakdown from ~/.config/Cursor/.../state.vscdb cursorDiskKV.
 * Prefers the most recently updated composer that belongs to this workspace.
 */
function readLiveContextUsage(roots: string[]): LiveComposerContext | undefined {
  const dbPath = findStateDbPath();
  if (!dbPath) {
    return undefined;
  }

  const rows = loadComposerDataRows(dbPath);
  if (!rows.length) {
    return undefined;
  }

  const workspaceIds = workspaceConversationIds(roots);
  const parsed: LiveComposerContext[] = [];

  for (const row of rows) {
    const live = parseComposerContext(row.key, row.value);
    if (live) {
      parsed.push(live);
    }
  }
  if (!parsed.length) {
    return undefined;
  }

  const inWorkspace = workspaceIds.size
    ? parsed.filter((p) => workspaceIds.has(p.composerId))
    : [];
  const pool = inWorkspace.length ? inWorkspace : parsed;
  pool.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  return pool[0];
}

function parseComposerContext(
  key: string,
  value: string
): LiveComposerContext | undefined {
  const composerId = key.startsWith("composerData:")
    ? key.slice("composerData:".length)
    : "";
  if (!composerId) {
    return undefined;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const breakdown = data.promptTokenBreakdown;
  if (!breakdown || typeof breakdown !== "object") {
    return undefined;
  }
  const bd = breakdown as {
    totalUsedTokens?: unknown;
    maxTokens?: unknown;
    categories?: unknown;
  };
  const cats = Array.isArray(bd.categories) ? bd.categories : [];
  if (!cats.length) {
    return undefined;
  }

  const tokens: Record<ContextUsageCategory["id"], number> = {
    systemPrompt: 0,
    toolDefinitions: 0,
    rules: 0,
    skills: 0,
    mcp: 0,
    subagents: 0,
    conversation: 0,
  };

  for (const raw of cats) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const cat = raw as { id?: unknown; estimatedTokens?: unknown };
    const id =
      typeof cat.id === "string" ? LIVE_CATEGORY_MAP[cat.id] : undefined;
    if (!id) {
      continue;
    }
    const n = Number(cat.estimatedTokens);
    if (Number.isFinite(n) && n > 0) {
      tokens[id] += n;
    }
  }

  const fromCats = Object.values(tokens).reduce((s, n) => s + n, 0);
  const usedTokens = Math.max(
    0,
    Math.round(
      Number.isFinite(Number(bd.totalUsedTokens))
        ? Number(bd.totalUsedTokens)
        : fromCats
    )
  );
  const windowTokens = Math.max(
    1,
    Math.round(
      Number.isFinite(Number(bd.maxTokens)) && Number(bd.maxTokens) > 0
        ? Number(bd.maxTokens)
        : BASELINE.windowTokens
    )
  );

  const pctRaw = Number(data.contextUsagePercent);
  const percentFull = Number.isFinite(pctRaw)
    ? Math.min(100, Math.max(0, pctRaw))
    : Math.min(100, (usedTokens / windowTokens) * 100);

  const lastUpdatedAt = Number(data.lastUpdatedAt) || Number(data.createdAt) || 0;

  return {
    composerId,
    lastUpdatedAt,
    percentFull,
    usedTokens,
    windowTokens,
    tokens,
  };
}

function workspaceConversationIds(roots: string[]): Set<string> {
  const ids = new Set<string>();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const root of roots) {
    const project = cursorProjectDir(root);
    if (!project) {
      continue;
    }
    const dir = path.join(project, "agent-transcripts");
    if (!fs.existsSync(dir)) {
      continue;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (uuidRe.test(name)) {
        ids.add(name);
      }
    }
  }
  return ids;
}

function loadComposerDataRows(
  dbPath: string
): Array<{ key: string; value: string }> {
  // Direct read first — copying a several-hundred-MB state.vscdb (sync, on the
  // extension-host thread) on every refresh is the expensive fallback.
  const direct =
    tryNodeSqliteComposerRows(dbPath) ?? tryPythonSqliteComposerRows(dbPath);
  if (direct !== undefined) {
    return direct;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-usage-ctx-"));
  const tmpDb = path.join(tmpDir, "state.vscdb");
  try {
    fs.copyFileSync(dbPath, tmpDb);
    for (const suffix of ["-wal", "-shm"] as const) {
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
      tryNodeSqliteComposerRows(tmpDb) ??
      tryPythonSqliteComposerRows(tmpDb) ??
      []
    );
  } catch {
    return [];
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function tryNodeSqliteComposerRows(
  dbPath: string
): Array<{ key: string; value: string }> | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        opts?: { readOnly?: boolean }
      ) => {
        prepare: (sql: string) => {
          all: (...params: unknown[]) => Array<{ key?: unknown; value?: unknown }>;
        };
        close: () => void;
      };
    };
    const db = new mod.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
        )
        .all();
      return rows
        .map((r) => ({
          key: typeof r.key === "string" ? r.key : "",
          value:
            typeof r.value === "string"
              ? r.value
              : Buffer.isBuffer(r.value)
                ? r.value.toString("utf8")
                : "",
        }))
        .filter((r) => r.key && r.value);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function tryPythonSqliteComposerRows(
  dbPath: string
): Array<{ key: string; value: string }> | undefined {
  // Single expression so `python -c` with `;` join stays valid.
  const script = [
    "import sqlite3,sys,json",
    "conn=sqlite3.connect(sys.argv[1])",
    "rows=[{'key':k,'value':(v.decode('utf-8','replace') if isinstance(v,bytes) else v)} for k,v in conn.execute(\"SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'\") if isinstance(k,str) and v is not None]",
    "sys.stdout.write(json.dumps(rows))",
  ].join(";");

  for (const bin of ["python3", "python", "py"]) {
    try {
      const stdout = execFileSync(bin, ["-c", script, dbPath], {
        timeout: 15000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      });
      const parsed = JSON.parse(String(stdout || "[]")) as Array<{
        key?: string;
        value?: string;
      }>;
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      return parsed
        .map((r) => ({
          key: typeof r.key === "string" ? r.key : "",
          value: typeof r.value === "string" ? r.value : "",
        }))
        .filter((r) => r.key && r.value);
    } catch {
      // try next
    }
  }
  return undefined;
}

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function readText(filePath: string, maxBytes = 512_000): string {
  try {
    const buf = fs.readFileSync(filePath);
    const slice = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
    return slice.toString("utf8");
  } catch {
    return "";
  }
}

function estimateRules(roots: string[]): number {
  let total = 0;
  const seen = new Set<string>();

  for (const root of roots) {
    const candidates = [
      path.join(root, ".cursorrules"),
      path.join(root, "AGENTS.md"),
      path.join(root, ".cursor", "AGENTS.md"),
    ];
    for (const file of candidates) {
      if (seen.has(file) || !fs.existsSync(file)) {
        continue;
      }
      seen.add(file);
      total += estimateTokens(readText(file));
    }

    const rulesDir = path.join(root, ".cursor", "rules");
    total += sumDirTokens(rulesDir, (name) =>
      /\.(mdc|md|txt)$/i.test(name)
    );
  }

  const homeRules = path.join(os.homedir(), ".cursor", "rules");
  total += sumDirTokens(homeRules, (name) => /\.(mdc|md|txt)$/i.test(name));

  return total;
}

/**
 * Skills inject name + description into context, not the full body.
 * Take a capped prefix of each SKILL.md as a stand-in for the catalog entry.
 */
function estimateSkills(roots: string[]): number {
  const skillFiles = new Set<string>();
  const home = os.homedir();

  for (const dir of [
    path.join(home, ".cursor", "skills-cursor"),
    path.join(home, ".cursor", "skills"),
    path.join(home, ".claude", "skills"),
  ]) {
    collectSkillFiles(dir, skillFiles);
  }

  // Plugin-bundled skills (deep trees: cache/<publisher>/<plugin>/<hash>/skills/…)
  const plugins = path.join(home, ".cursor", "plugins", "cache");
  if (fs.existsSync(plugins)) {
    collectSkillFiles(plugins, skillFiles, 8);
  }

  for (const root of roots) {
    collectSkillFiles(path.join(root, ".cursor", "skills"), skillFiles);
    collectSkillFiles(path.join(root, "skills"), skillFiles);
  }

  let total = 0;
  for (const file of skillFiles) {
    const text = readText(file, 8_000);
    total += estimateTokens(skillCatalogSlice(text));
  }
  return total;
}

function skillCatalogSlice(text: string): string {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const desc = fm[1].match(
      /(?:^|\n)description:\s*["']?([\s\S]*?)(?=\n[a-zA-Z_][\w-]*:|\n---|$)/
    );
    const name = fm[1].match(/(?:^|\n)name:\s*["']?([^\n"']+)/);
    const parts = [name?.[1]?.trim(), desc?.[1]?.trim()].filter(Boolean);
    if (parts.length) {
      return parts.join("\n").slice(0, 1200);
    }
  }
  return text.slice(0, 1200);
}

function collectSkillFiles(
  dir: string,
  out: Set<string>,
  maxDepth = 3,
  depth = 0
): void {
  if (depth > maxDepth || !fs.existsSync(dir)) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name === "SKILL.md") {
      out.add(full);
    } else if (ent.isDirectory()) {
      collectSkillFiles(full, out, maxDepth, depth + 1);
    }
  }
}

function estimateMcp(roots: string[]): number {
  let total = 0;
  const projectDirs = roots
    .map((r) => cursorProjectDir(r))
    .filter((p): p is string => !!p);

  for (const project of projectDirs) {
    const mcpsRoot = path.join(project, "mcps");
    if (!fs.existsSync(mcpsRoot)) {
      continue;
    }
    let servers: string[];
    try {
      servers = fs.readdirSync(mcpsRoot);
    } catch {
      continue;
    }
    for (const server of servers) {
      const base = path.join(mcpsRoot, server);
      try {
        if (!fs.statSync(base).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      total += estimateTokens(readText(path.join(base, "INSTRUCTIONS.md")));
      total += estimateTokens(readText(path.join(base, "SERVER_METADATA.json")));
      total += estimateTokens(readText(path.join(base, "STATUS.md")));
      total += estimateMcpToolCatalog(path.join(base, "tools"));
    }
  }

  for (const root of roots) {
    for (const file of [
      path.join(root, ".cursor", "mcp.json"),
      path.join(root, "mcp.json"),
    ]) {
      total += estimateTokens(readText(file, 64_000));
    }
  }
  total += estimateTokens(
    readText(path.join(os.homedir(), ".cursor", "mcp.json"), 64_000)
  );

  return total;
}

function estimateMcpToolCatalog(toolsDir: string): number {
  if (!fs.existsSync(toolsDir)) {
    return 0;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(toolsDir);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of entries) {
    if (!/\.json$/i.test(name)) {
      continue;
    }
    const raw = readText(path.join(toolsDir, name), 16_000);
    if (!raw) {
      continue;
    }
    try {
      const obj = JSON.parse(raw) as {
        name?: unknown;
        description?: unknown;
      };
      const parts = [
        typeof obj.name === "string" ? obj.name : name.replace(/\.json$/i, ""),
        typeof obj.description === "string"
          ? obj.description.slice(0, 240)
          : "",
      ].filter(Boolean);
      total += estimateTokens(parts.join("\n"));
    } catch {
      total += estimateTokens(name.replace(/\.json$/i, ""));
    }
  }
  return total;
}

function estimateConversation(roots: string[]): number {
  let best = 0;
  for (const root of roots) {
    const project = cursorProjectDir(root);
    if (!project) {
      continue;
    }
    const transcripts = path.join(project, "agent-transcripts");
    if (!fs.existsSync(transcripts)) {
      continue;
    }
    const files = listFilesRecursive(transcripts, (n) => n.endsWith(".jsonl"), 3);
    files.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });
    if (files[0]) {
      best = Math.max(best, estimateTranscriptTokens(files[0]));
    }
  }
  return best;
}

/**
 * Resolve `~/.cursor/projects/<slug>` for a workspace folder.
 * Cursor slugs replace `/`, spaces, and `_` with `-`.
 */
function cursorProjectDir(workspaceRoot: string): string | undefined {
  const home = os.homedir();
  const projects = path.join(home, ".cursor", "projects");
  if (!fs.existsSync(projects)) {
    return undefined;
  }

  const slug = projectSlugFromPath(workspaceRoot);
  const direct = path.join(projects, slug);
  if (fs.existsSync(direct)) {
    return direct;
  }

  try {
    const names = fs.readdirSync(projects);
    const slugN = normalizeSlugKey(slug);
    const baseN = normalizeSlugKey(path.basename(workspaceRoot));
    const hit =
      names.find((n) => {
        const nn = normalizeSlugKey(n);
        return nn === slugN || slugN.endsWith(nn) || nn.endsWith(slugN);
      }) ??
      names.find((n) => {
        const nn = normalizeSlugKey(n);
        return baseN.length > 0 && (nn.endsWith("-" + baseN) || nn === baseN);
      });
    return hit ? path.join(projects, hit) : undefined;
  } catch {
    return undefined;
  }
}

function projectSlugFromPath(workspaceRoot: string): string {
  return workspaceRoot
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/[/\s_]+/g, "-");
}

function normalizeSlugKey(s: string): string {
  return s.toLowerCase().replace(/_/g, "-");
}

function sumDirTokens(
  dir: string,
  filter: (name: string) => boolean,
  maxDepth = 2
): number {
  let total = 0;
  for (const file of listFilesRecursive(dir, filter, maxDepth)) {
    total += estimateTokens(readText(file));
  }
  return total;
}

function listFilesRecursive(
  dir: string,
  filter: (name: string) => boolean,
  maxDepth: number,
  depth = 0
): string[] {
  if (depth > maxDepth || !fs.existsSync(dir)) {
    return [];
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && filter(ent.name)) {
      out.push(full);
    } else if (ent.isDirectory() && !ent.name.startsWith(".")) {
      out.push(...listFilesRecursive(full, filter, maxDepth, depth + 1));
    }
  }
  return out;
}
