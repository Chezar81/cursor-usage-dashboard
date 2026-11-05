import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiConversationIds,
  estimateTokensFromJsonl,
  extractConversationId,
  titleFromTranscriptJsonl,
  titleFromUserText,
} from "../src/localActivity";
import {
  canonicalizeWorkspaceIdentity,
  identityFromProjectSlug,
} from "../src/conversationWorkspaceMap";
import { NO_WORKSPACE_ID } from "../src/workspaceLabels";

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
