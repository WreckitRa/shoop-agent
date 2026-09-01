/**
 * Per-search funnel, latency, cost, and taste_fit diagnostic.
 */

/** USD / 1M tokens — same table as eval/cost.ts. */
const MODEL_USD_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-4-8": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },
};

function estimateUsd(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}): number {
  const rates =
    MODEL_USD_PER_MTOK[params.model] ?? MODEL_USD_PER_MTOK["claude-sonnet-5"]!;
  const uncachedInput = Math.max(
    0,
    params.inputTokens - (params.cacheReadInputTokens ?? 0),
  );
  const usd =
    (uncachedInput * rates.input) / 1_000_000 +
    ((params.cacheReadInputTokens ?? 0) * rates.cacheRead) / 1_000_000 +
    ((params.cacheCreationInputTokens ?? 0) * rates.cacheWrite) / 1_000_000 +
    (params.outputTokens * rates.output) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

export type SearchFunnelSlotCounts = {
  slot_id: string;
  garment: string;
  mcp_hits: number;
  deduped: number;
  normalized: number;
  hard_drop_survivors: number;
  scored: number;
  shortlisted: number;
  hydrated_verified: number;
  imaged: number;
  heroes: number;
};

export type SearchStageLatency = {
  planner_ms: number;
  fan_out_ms: number;
  normalize_ms: number;
  hard_drops_ms: number;
  score_ms: number;
  taste_rerank_ms: number;
  hydrate_ms: number;
  /** Wall of prepareCurationImages at Stage A (cache hits after verify-prefetch ≈ 0). */
  image_prep_ms: number;
  stage_a_ms: number;
  stage_b_ms: number;
  render_ms: number;
  total_to_provisional_ms: number | null;
  total_to_final_ms: number | null;
};

export type SearchMcpQueryStats = {
  n: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
};

export type SearchCostByStage = {
  stage: string;
  usd: number;
  calls: number;
};

export type SearchCost = {
  usd: number;
  by_stage: SearchCostByStage[];
};

export type SearchTasteFitLog = {
  preference_anchor: string | null;
  mean: number | null;
  heroes: Array<{
    product_id: string;
    slot_id: string;
    taste_fit: number | null;
    considered: number;
    matched: number;
    contradicted: number;
  }>;
};

export type SearchLaneMix = {
  usual: number;
  adjacent: number;
  new: number;
  unlabeled: number;
};

export type SearchSlotLaneLog = {
  slot_id: string;
  garment: string;
  verified: SearchLaneMix;
  imaged: SearchLaneMix;
  heroes: SearchLaneMix;
};

export type SearchTasteRerankStats = {
  calls: number;
  aborted: number;
  rated: number;
  input_tokens: number;
  output_tokens: number;
  cache_hits?: number;
};

export type SearchObservability = {
  version: 1;
  funnel: SearchFunnelSlotCounts[];
  latency: SearchStageLatency;
  cost: SearchCost;
  taste_fit: SearchTasteFitLog;
  taste_rerank?: SearchTasteRerankStats;
  lanes_by_slot?: SearchSlotLaneLog[];
  refinement_mode?: "rescore-only" | "partial" | "full";
  mcp_query?: SearchMcpQueryStats;
};

export function emptyLaneMix(): SearchLaneMix {
  return { usual: 0, adjacent: 0, new: 0, unlabeled: 0 };
}

export function laneMixFromRatings(
  products: Array<{ taste_rating?: { lane?: string } | null }>,
): SearchLaneMix {
  const out = emptyLaneMix();
  for (const p of products) {
    const lane = p.taste_rating?.lane;
    if (lane === "usual" || lane === "adjacent" || lane === "new") {
      out[lane] += 1;
    } else {
      out.unlabeled += 1;
    }
  }
  return out;
}

export function emptyStageLatency(
  overrides: Partial<SearchStageLatency> = {},
): SearchStageLatency {
  return {
    planner_ms: 0,
    fan_out_ms: 0,
    normalize_ms: 0,
    hard_drops_ms: 0,
    score_ms: 0,
    taste_rerank_ms: 0,
    hydrate_ms: 0,
    image_prep_ms: 0,
    stage_a_ms: 0,
    stage_b_ms: 0,
    render_ms: 0,
    total_to_provisional_ms: null,
    total_to_final_ms: null,
    ...overrides,
  };
}

const ROUTER_OR_EVAL_STAGE = /^(router|eval_)/;

export type TurnLlmCallRecord = {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
};

const turnLlmBuffers = new Map<string, TurnLlmCallRecord[]>();

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function beginTurnLlmCostBuffer(traceId: string): void {
  if (!isUuid(traceId)) return;
  turnLlmBuffers.set(traceId, []);
}

export function recordTurnLlmCall(
  traceId: string | null | undefined,
  record: TurnLlmCallRecord,
): void {
  if (!traceId || !isUuid(traceId)) return;
  const buf = turnLlmBuffers.get(traceId);
  if (!buf) return;
  buf.push(record);
}

export function drainTurnLlmCostBuffer(
  traceId: string | null | undefined,
): SearchCost {
  if (!traceId || !isUuid(traceId)) {
    return { usd: 0, by_stage: [] };
  }
  const records = turnLlmBuffers.get(traceId) ?? [];
  turnLlmBuffers.delete(traceId);
  return costFromLlmCalls(records);
}

export function costFromLlmCalls(records: TurnLlmCallRecord[]): SearchCost {
  const byStage = new Map<string, { usd: number; calls: number }>();
  let usd = 0;
  for (const r of records) {
    if (ROUTER_OR_EVAL_STAGE.test(r.stage)) continue;
    const callUsd = estimateUsd({
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadInputTokens: r.cacheReadInputTokens ?? undefined,
      cacheCreationInputTokens: r.cacheCreationInputTokens ?? undefined,
    });
    usd += callUsd;
    const prev = byStage.get(r.stage) ?? { usd: 0, calls: 0 };
    prev.usd += callUsd;
    prev.calls += 1;
    byStage.set(r.stage, prev);
  }
  const by_stage = [...byStage.entries()].map(([stage, v]) => ({
    stage,
    usd: Math.round(v.usd * 10_000) / 10_000,
    calls: v.calls,
  }));
  return { usd: Math.round(usd * 10_000) / 10_000, by_stage };
}

export function mcpHitsFromQueryLogs(
  logs: Array<{ raw_count?: number }>,
): number {
  return logs.reduce((n, l) => n + (l.raw_count ?? 0), 0);
}

export function percentileMs(values: number[], p: number): number | null {
  const a = values.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))]!;
}

export function mcpQueryDurationStats(
  logs: Array<{ duration_ms?: number }>,
): SearchMcpQueryStats {
  const values = logs
    .map((l) => l.duration_ms)
    .filter((n): n is number => n != null && Number.isFinite(n));
  return {
    n: values.length,
    p50_ms: percentileMs(values, 0.5),
    p95_ms: percentileMs(values, 0.95),
    max_ms: values.length ? Math.max(...values) : null,
  };
}
