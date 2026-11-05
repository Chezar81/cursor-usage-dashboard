import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAutoModelIntent,
  modelsGroupedByRoutedFromAggregated,
  modelsGroupedByRoutedModel,
} from "../src/modelRouting";
import type { FilteredUsageEvent } from "../src/types";

test("isAutoModelIntent recognizes router spellings", () => {
  for (const intent of ["default", "auto", "auto-smart", "Auto (Default)", "vega", "vega-2", "cursor-router-x", ""]) {
    assert.equal(isAutoModelIntent(intent), true, intent);
  }
  for (const intent of ["grok-4.6", "composer-2.5", "claude-sonnet-5"]) {
    assert.equal(isAutoModelIntent(intent), false, intent);
  }
  assert.equal(isAutoModelIntent(undefined), true);
});

test("modelsGroupedByRoutedModel groups Auto and manual by serving model", () => {
  const events: FilteredUsageEvent[] = [
    {
      modelIntent: "default",
      model: "grok-4.6",
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
      chargedCents: 20,
    },
    {
      modelIntent: "grok-4.6",
      model: "grok-4.6",
      tokenUsage: { inputTokens: 1, outputTokens: 1 },
      chargedCents: 2,
    },
    {
      modelIntent: "default",
      model: "composer-2.5",
      tokenUsage: { inputTokens: 3 },
      chargedCents: 1,
    },
  ];
  const rows = modelsGroupedByRoutedModel(events);
  assert.equal(rows.length, 2);
  const grok = rows.find((r) => r.model === "grok-4.6")!;
  assert.equal(grok.totalTokens, 17);
  assert.equal(grok.costCents, 22);
  assert.equal(grok.autoRequests, 1);
  assert.equal(grok.manualRequests, 1);
  // Sorted by cost desc.
  assert.equal(rows[0].model, "grok-4.6");
});

test("modelsGroupedByRoutedModel falls back to intent when model missing", () => {
  const rows = modelsGroupedByRoutedModel([
    { modelIntent: "grok-4.7", tokenUsage: { inputTokens: 4 } },
    { tokenUsage: { inputTokens: 1 } },
  ]);
  assert.equal(rows.find((r) => r.model === "grok-4.7")?.totalTokens, 4);
  assert.equal(rows.find((r) => r.model === "unknown")?.totalTokens, 1);
});

test("modelsGroupedByRoutedFromAggregated collapses intent variants", () => {
  const rows = modelsGroupedByRoutedFromAggregated([
    { modelIntent: "default", model: "grok-4.6", inputTokens: 10, totalCents: 30 },
    { modelIntent: "grok-4.6", model: "grok-4.6", inputTokens: 5, totalCents: 10 },
    { modelIntent: "default", model: "composer-2.5", inputTokens: 2, costCents: 1 },
  ]);
  assert.equal(rows.length, 2);
  const grok = rows.find((r) => r.model === "grok-4.6")!;
  assert.equal(grok.inputTokens, 15);
  assert.equal(grok.costCents, 40);
  assert.equal(grok.autoRequests, 1);
  assert.equal(grok.manualRequests, 1);
});
