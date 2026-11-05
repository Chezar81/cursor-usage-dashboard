import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { estimateTranscriptTokens } from "../src/localActivity";
import {
  mergeLocalModelActivity,
  modelFromComposerConfig,
  type LocalModelActivity,
} from "../src/localModelActivity";

test("modelFromComposerConfig prefers picker name, then selectedModels", () => {
  assert.equal(
    modelFromComposerConfig({
      modelName: "grok-4.7",
      selectedModels: [{ modelId: "grok-4.6" }],
    }),
    "grok-4.7"
  );
  assert.equal(
    modelFromComposerConfig({ selectedModels: [{ modelId: "composer-2.5" }] }),
    "composer-2.5"
  );
  assert.equal(modelFromComposerConfig({ modelName: "default" }), "default");
  assert.equal(modelFromComposerConfig(undefined), "default");
  assert.equal(modelFromComposerConfig("nope"), "default");
});

test("mergeLocalModelActivity: explicit model beats default across sources", () => {
  const tracking: LocalModelActivity[] = [
    { conversationId: "a", model: "default", lastActiveMs: 100 },
    { conversationId: "b", model: "grok-4.6", lastActiveMs: 50 },
  ];
  const composer: LocalModelActivity[] = [
    { conversationId: "a", model: "grok-4.7", lastActiveMs: 10 },
    { conversationId: "b", model: "default", lastActiveMs: 999 },
    { conversationId: "c", model: "default", lastActiveMs: 5 },
  ];
  const merged = mergeLocalModelActivity([tracking, composer]);
  const byId = new Map(merged.map((m) => [m.conversationId, m]));
  assert.equal(byId.get("a")?.model, "grok-4.7");
  assert.equal(byId.get("a")?.lastActiveMs, 100); // newest activity kept
  assert.equal(byId.get("b")?.model, "grok-4.6");
  assert.equal(byId.get("b")?.lastActiveMs, 999);
  assert.equal(byId.get("c")?.model, "default");
});

test("estimateTranscriptTokens counts beyond the old 2MB head cap", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-transcript-"));
  const file = path.join(dir, "chat.jsonl");
  try {
    // ~3MB of transcript text spread over many lines.
    const line =
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "text", text: "abcd".repeat(250) }] },
      }) + "\n";
    fs.writeFileSync(file, line.repeat(3000));
    const tokens = estimateTranscriptTokens(file);
    // 3000 lines × 1000 chars ÷ 4 = 750k; the old head-only read stopped ≈500k.
    assert.ok(tokens > 600_000, `expected >600k, got ${tokens}`);
    assert.equal(estimateTranscriptTokens(undefined), 0);
    assert.equal(estimateTranscriptTokens(path.join(dir, "missing.jsonl")), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
