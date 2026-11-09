import assert from "node:assert/strict";
import { test } from "node:test";
import { combineWorkspaceTokenSources } from "../src/workspaceTracker";

test("combineWorkspaceTokenSources keeps local estimate when API is empty", () => {
  assert.deepEqual(
    combineWorkspaceTokenSources({
      apiTokens: 0,
      apiCostCents: 0,
      localEstimatedTokens: 425342,
      apiAuthoritative: false,
      conversationMapped: false,
    }),
    { tokens: 425342, costCents: 0, tokensEstimated: true }
  );
});

test("combineWorkspaceTokenSources prefers larger local estimate over window billing", () => {
  assert.deepEqual(
    combineWorkspaceTokenSources({
      apiTokens: 1000,
      apiCostCents: 12.5,
      localEstimatedTokens: 50000,
      apiAuthoritative: true,
      conversationMapped: false,
    }),
    { tokens: 50000, costCents: 12.5, tokensEstimated: true }
  );
});

test("combineWorkspaceTokenSources keeps higher window billing tokens", () => {
  assert.deepEqual(
    combineWorkspaceTokenSources({
      apiTokens: 162_000_000,
      apiCostCents: 5668,
      localEstimatedTokens: 400_000,
      apiAuthoritative: true,
      conversationMapped: false,
    }),
    { tokens: 162_000_000, costCents: 5668, tokensEstimated: false }
  );
});

test("combineWorkspaceTokenSources adds unmatched locals on conversation-mapped API", () => {
  assert.deepEqual(
    combineWorkspaceTokenSources({
      apiTokens: 10_000,
      apiCostCents: 3,
      localEstimatedTokens: 2_000,
      apiAuthoritative: true,
      conversationMapped: true,
    }),
    { tokens: 12_000, costCents: 3, tokensEstimated: false }
  );
});
