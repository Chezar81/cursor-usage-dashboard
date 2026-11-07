import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { test } from "node:test";
import {
  analyzeTranscript,
  analyzeTranscriptWithOptionalCache,
  apiConversationIds,
  estimateTokensFromJsonl,
  extractConversationId,
  parseTranscriptTimestamp,
  titleFromTranscriptJsonl,
  titleFromUserText,
} from "../src/localActivity";
import { dayKeyLocal } from "../src/dates";
import {
  canonicalizeWorkspaceIdentity,
  identityFromProjectSlug,
} from "../src/conversationWorkspaceMap";
import {
  NO_WORKSPACE_ID,
  normalizeDisplayName,
} from "../src/workspaceLabels";


test("normalizeDisplayName collapses AnonBrowser rename onto MintShield", () => {
  assert.equal(normalizeDisplayName("AnonBrowser"), "mintshield");
  assert.equal(normalizeDisplayName("MintShield"), "mintshield");
  assert.equal(normalizeDisplayName("Usage_Dashboard"), "usage-dashboard");
});

test("normalizeDisplayName collapses Portable-Local-Studio onto Bavaria_Paratus_AI", () => {
  assert.equal(normalizeDisplayName("Portable-Local-Studio"), "bavaria-paratus-ai");
  assert.equal(normalizeDisplayName("Bavaria_Paratus_AI"), "bavaria-paratus-ai");
  assert.equal(normalizeDisplayName("portable_local_studio"), "bavaria-paratus-ai");
  assert.equal(
    normalizeDisplayName("Portable-Local-Studio (Workspace)"),
    "bavaria-paratus-ai"
  );
  assert.equal(
    normalizeDisplayName("Bavaria_Paratus_AI (Workspace)"),
    "bavaria-paratus-ai"
  );
});

test("analyzeTranscriptWithOptionalCache skips re-read when mtime+size match", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cud-tcache-"));
  const file = path.join(dir, "t.jsonl");
  const line = JSON.stringify({
    role: "user",
    message: { content: "<user_query>a</user_query>" },
  });
  fs.writeFileSync(file, line + "\n", "utf8");
  const cacheDir = path.join(dir, "storage");
  const a1 = analyzeTranscriptWithOptionalCache(file, "2026-01-01", cacheDir);
  const a2 = analyzeTranscriptWithOptionalCache(file, "2026-01-01", cacheDir);
  assert.equal(a1.estimatedRequests, a2.estimatedRequests);
  assert.ok(a1.estimatedTokens > 0);
  // grow file → cache miss → recompute
  fs.appendFileSync(file, line + "\n", "utf8");
  const a3 = analyzeTranscriptWithOptionalCache(file, "2026-01-01", cacheDir);
  assert.ok(a3.estimatedTokens > a1.estimatedTokens);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("analyzeTranscript matches uncached path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cud-tplain-"));
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(
    file,
    JSON.stringify({ role: "user", message: { content: "hi" } }) + "\n",
    "utf8"
  );
  assert.deepEqual(analyzeTranscript(file, "2026-06-01"), analyzeTranscriptWithOptionalCache(file, "2026-06-01", undefined));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("estimateTokensFromJsonl counts text-bearing fields at chars/4", () => {
  const raw = JSON.stringify({
    role: "assistant",
    message: { content: [{ type: "text", text: "abcd".repeat(10) }] },
  });
  assert.equal(estimateTokensFromJsonl(raw), 10);
  assert.equal(estimateTokensFromJsonl(""), 0);
  // Unparseable lines fall back to raw length.
  assert.equal(estimateTokensFromJsonl("abcdefgh"), 2);
});

test("parseTranscriptTimestamp reads Cursor stamp with UTC offset", () => {
  const ms = parseTranscriptTimestamp(
    "<timestamp>Friday, Nov 6, 2026, 11:16 AM (UTC+1)</timestamp>\nhello"
  );
  assert.equal(ms, Date.parse("Nov 6, 2026, 11:16 AM +01:00"));
  assert.equal(dayKeyLocal(ms!), "2026-11-06");
  assert.equal(parseTranscriptTimestamp("no stamp"), undefined);
});

test("titleFromTranscriptJsonl takes the first user message", () => {
  const raw = [
    JSON.stringify({ role: "assistant", message: { content: "ignored" } }),
    JSON.stringify({
      role: "user",
      message: { content: "<user_query>Fix the thing</user_query>" },
    }),
    JSON.stringify({ role: "user", message: { content: "second" } }),
  ].join("\n");
  assert.equal(titleFromTranscriptJsonl(raw), "Fix the thing");
  assert.equal(titleFromTranscriptJsonl("not json"), "");
});

test("titleFromUserText strips tags, collapses whitespace, truncates", () => {
  assert.equal(titleFromUserText("<b>hello</b>\n  world"), "hello world");
  const long = titleFromUserText("a".repeat(300));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
  assert.equal(titleFromUserText("   "), "");
});

test("extractConversationId checks known keys in order and trims", () => {
  assert.equal(
    extractConversationId({ conversationId: " a ", composerId: "b" }),
    "a"
  );
  assert.equal(extractConversationId({ composerId: "b" }), "b");
  assert.equal(extractConversationId({ conversationId: 42 as never }), undefined);
  assert.equal(extractConversationId({}), undefined);
});

test("apiConversationIds collects distinct ids", () => {
  const ids = apiConversationIds([
    { conversationId: "x" },
    { composerId: "y" },
    { conversationId: "x" },
    {},
  ]);
  assert.deepEqual([...ids].sort(), ["x", "y"]);
});

test("identityFromProjectSlug maps special slugs", () => {
  assert.equal(identityFromProjectSlug("empty-window").workspaceId, NO_WORKSPACE_ID);
  const tmp = identityFromProjectSlug("tmp-123");
  assert.equal(tmp.displayName, "Temporary");
  const numeric = identityFromProjectSlug("12345678901");
  assert.equal(numeric.workspaceId, "cursor-project:12345678901");
});

test("canonicalizeWorkspaceIdentity folds legacy no-folder aliases", () => {
  assert.deepEqual(
    canonicalizeWorkspaceIdentity({ workspaceId: "no-folder", displayName: "x" }),
    { workspaceId: NO_WORKSPACE_ID, displayName: "No workspace" }
  );
  assert.deepEqual(
    canonicalizeWorkspaceIdentity({
      workspaceId: "cursor-project:tmp-9",
      displayName: "whatever",
    }),
    { workspaceId: "cursor-project:tmp-9", displayName: "Temporary" }
  );
});

test("canonicalizeWorkspaceIdentity folds AnonBrowser into MintShield", () => {
  const mint = canonicalizeWorkspaceIdentity({
    workspaceId: "file:///home/chezar/Dokumente/Cursor%20Workspaces/MintShield",
    displayName: "MintShield",
  });
  const anon = canonicalizeWorkspaceIdentity({
    workspaceId: "file:///home/chezar/Dokumente/Cursor%20Workspaces/AnonBrowser",
    displayName: "AnonBrowser",
  });
  assert.equal(anon.displayName, "MintShield");
  assert.equal(anon.workspaceId, mint.workspaceId);
  assert.equal(
    identityFromProjectSlug(
      "home-chezar-Dokumente-Cursor-Workspaces-AnonBrowser"
    ).displayName,
    "MintShield"
  );
});

test("canonicalizeWorkspaceIdentity folds Portable-Local-Studio into Bavaria_Paratus_AI when present", () => {
  const bavariaRoot = path.join(
    os.homedir(),
    "Dokumente",
    "Cursor Workspaces",
    "Bavaria_Paratus_AI"
  );
  if (!fs.existsSync(bavariaRoot)) {
    // Folder rename happens in a separate migrate step; map still normalizes labels.
    assert.equal(normalizeDisplayName("Portable-Local-Studio"), "bavaria-paratus-ai");
    return;
  }
  const bavaria = canonicalizeWorkspaceIdentity({
    workspaceId: "file:///home/chezar/Dokumente/Cursor%20Workspaces/Bavaria_Paratus_AI",
    displayName: "Bavaria_Paratus_AI",
  });
  const portable = canonicalizeWorkspaceIdentity({
    workspaceId: "file:///home/chezar/Dokumente/Cursor%20Workspaces/Portable-Local-Studio",
    displayName: "Portable-Local-Studio",
  });
  assert.equal(portable.displayName, "Bavaria_Paratus_AI");
  assert.equal(portable.workspaceId, bavaria.workspaceId);
  assert.equal(
    identityFromProjectSlug(
      "home-chezar-Dokumente-Cursor-Workspaces-Portable-Local-Studio"
    ).displayName,
    "Bavaria_Paratus_AI"
  );
  const portableMulti = canonicalizeWorkspaceIdentity({
    workspaceId:
      "multi:file:///home/chezar/Dokumente/Cursor%20Workspaces/Portable-Local-Studio|file:///media/chezar/SD-Karte",
    displayName: "Portable-Local-Studio (Workspace)",
  });
  assert.equal(portableMulti.workspaceId, bavaria.workspaceId);
  assert.equal(portableMulti.displayName, "Bavaria_Paratus_AI");
  const bavariaMulti = canonicalizeWorkspaceIdentity({
    workspaceId:
      "multi:file:///home/chezar/Dokumente/Cursor%20Workspaces/Bavaria_Paratus_AI|file:///home/chezar/Dropbox/Synchronisation/Obsidian/Obsidian%20Vault/Bavaria%20Paratus|file:///media/chezar/SD-Karte/Bavaria%20Paratus%20AI",
    displayName: "Bavaria_Paratus_AI (Workspace)",
  });
  assert.equal(bavariaMulti.workspaceId, bavaria.workspaceId);
  assert.equal(bavariaMulti.displayName, "Bavaria_Paratus_AI");
});

