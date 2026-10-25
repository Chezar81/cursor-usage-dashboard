import type { AggregatedModelUsage, FilteredUsageEvent, ModelBreakdown } from "./types";

function usageEventCostCents(ev: FilteredUsageEvent): number {
  if (typeof ev.chargedCents === "number") {
    return ev.chargedCents;
  }
  if (typeof ev.costCents === "number") {
    return ev.costCents;
  }
  if (typeof ev.usageBasedCosts === "number") {
    return ev.usageBasedCosts;
  }
  if (typeof ev.usageBasedCosts === "string") {
    const n = Number(ev.usageBasedCosts.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) {
      return n < 50 && n !== Math.floor(n) ? Math.round(n * 100) : Math.round(n);
    }
  }
  return 0;
}

/** Picker / billing intent values that mean Cursor Auto (router). */
export function isAutoModelIntent(intent: string | undefined): boolean {
  const t = (intent ?? "").trim().toLowerCase();
  if (!t || t === "default" || t === "auto" || t === "auto-smart") {
    return true;
  }
  if (t === "auto (default)") {
    return true;
  }
  if (t.startsWith("auto-smart") || t.includes("cursor-router")) {
    return true;
  }
  if (t === "vega" || t.startsWith("vega-")) {
    return true;
  }
  return false;
}

function routedModelFromEvent(ev: FilteredUsageEvent): string {
  const actual = ev.model != null ? String(ev.model).trim() : "";
  const intent = ev.modelIntent != null ? String(ev.modelIntent).trim() : "";
  return actual || intent || "unknown";
}

function rawIntentFromEvent(ev: FilteredUsageEvent): string {
  return ev.modelIntent != null ? String(ev.modelIntent).trim() : "";
}

function addEventToRoutedRow(
  map: Map<string, ModelBreakdown>,
  routed: string,
  auto: boolean,
  ev: FilteredUsageEvent
): void {
  let row = map.get(routed);
  if (!row) {
    row = {
      modelIntent: routed,
      model: routed,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costCents: 0,
      autoRequests: 0,
      manualRequests: 0,
    };
    map.set(routed, row);
  }
  const t = ev.tokenUsage;
  row.inputTokens += num(t?.inputTokens);
  row.outputTokens += num(t?.outputTokens);
  row.cacheReadTokens += num(t?.cacheReadTokens);
  row.cacheWriteTokens += num(t?.cacheWriteTokens);
  row.costCents += usageEventCostCents(ev);
  if (auto) {
    row.autoRequests = (row.autoRequests ?? 0) + 1;
  } else {
    row.manualRequests = (row.manualRequests ?? 0) + 1;
  }
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Group usage events by the model that actually served the request. */
export function modelsGroupedByRoutedModel(events: FilteredUsageEvent[]): ModelBreakdown[] {
  const map = new Map<string, ModelBreakdown>();
  for (const ev of events) {
    const routed = routedModelFromEvent(ev);
    const intentRaw = rawIntentFromEvent(ev);
    const auto = intentRaw ? isAutoModelIntent(intentRaw) : false;
    addEventToRoutedRow(map, routed, auto, ev);
  }
  return finalizeRoutedRows(map);
}

/** Collapse intent×actual aggregation rows into routed-model totals. */
export function modelsGroupedByRoutedFromAggregated(
  rows: AggregatedModelUsage[]
): ModelBreakdown[] {
  const map = new Map<string, ModelBreakdown>();
  for (const row of rows) {
    const intentRaw = row.modelIntent != null ? String(row.modelIntent).trim() : "";
    const actualRaw = row.model != null ? String(row.model).trim() : "";
    const routed = actualRaw || intentRaw || "unknown";
    const auto = isAutoModelIntent(intentRaw);
    let dest = map.get(routed);
    if (!dest) {
      dest = {
        modelIntent: routed,
        model: routed,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costCents: 0,
        autoRequests: 0,
        manualRequests: 0,
      };
      map.set(routed, dest);
    }
    dest.inputTokens += num(row.inputTokens);
    dest.outputTokens += num(row.outputTokens);
    dest.cacheReadTokens += num(row.cacheReadTokens);
    dest.cacheWriteTokens += num(row.cacheWriteTokens);
    dest.costCents += num(row.totalCents ?? row.costCents);
    // Aggregates have no per-request count; treat each row as one bucket contribution.
    if (auto) {
      dest.autoRequests = (dest.autoRequests ?? 0) + 1;
    } else {
      dest.manualRequests = (dest.manualRequests ?? 0) + 1;
    }
  }
  return finalizeRoutedRows(map);
}

function finalizeRoutedRows(map: Map<string, ModelBreakdown>): ModelBreakdown[] {
  const models = [...map.values()].map((m) => ({
    ...m,
    totalTokens:
      m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens,
  }));
  models.sort((a, b) => b.costCents - a.costCents || b.totalTokens - a.totalTokens);
  return models;
}
