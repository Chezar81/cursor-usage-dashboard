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
  configureWorkspaceRenames,
  normalizeDisplayName,
} from "../src/workspaceLabels";

test("normalizeDisplayName applies configured workspace renames", () => {
  configureWorkspaceRenames({
    "old-project": "New_Project",
    "legacy studio": "Current_Studio",
  });
  try {
    assert.equal(normalizeDisplayName("Old_Project"), "new-project");
    assert.equal(normalizeDisplayName("New_Project"), "new-project");
    assert.equal(normalizeDisplayName("Usage_Dashboard"), "usage-dashboard");
    assert.equal(normalizeDisplayName("legacy_studio"), "current-studio");
    assert.equal(
      normalizeDisplayName("Legacy Studio (Workspace)"),
      "current-studio"
    );
    assert.equal(
      normalizeDisplayName("Current_Studio (Workspace)"),
      "current-studio"
    );
  } finally {
    configureWorkspaceRenames({});
  }
});

test("normalizeDisplayName is a no-op without configured renames", () => {
  configureWorkspaceRenames({});
  assert.equal(normalizeDisplayName("Old_Project"), "old-project");
  assert.equal(normalizeDisplayName("Some_Folder"), "some-folder");
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

test("canonicalizeWorkspaceIdentity applies configured display renames", () => {
  configureWorkspaceRenames({ "old-app": "New_App" });
  try {
    const current = canonicalizeWorkspaceIdentity({
      workspaceId: "file:///tmp/workspaces/New_App",
      displayName: "New_App",
    });
    const legacy = canonicalizeWorkspaceIdentity({
      workspaceId: "file:///tmp/workspaces/Old_App",
      displayName: "Old_App",
    });
    assert.equal(current.displayName, "New_App");
    assert.equal(legacy.displayName, "New_App");
    assert.equal(normalizeDisplayName(legacy.displayName), "new-app");
  } finally {
    configureWorkspaceRenames({});
  }
});

