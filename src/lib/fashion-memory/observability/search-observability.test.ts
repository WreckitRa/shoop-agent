import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  costFromLlmCalls,
  emptyStageLatency,
  laneMixFromRatings,
  mcpHitsFromQueryLogs,
} from "./search-observability";

describe("search observability helpers", () => {
  it("excludes router and eval stages from search cost", () => {
    const cost = costFromLlmCalls([
      {
        stage: "router",
        model: "claude-sonnet-5",
        inputTokens: 10_000,
        outputTokens: 800,
      },
      {
        stage: "planner",
        model: "claude-haiku-4-5-20251001",
        inputTokens: 2000,
        outputTokens: 400,
      },
      {
        stage: "eval_judge",
        model: "claude-opus-4-8",
        inputTokens: 4000,
        outputTokens: 400,
      },
    ]);
    assert.equal(cost.by_stage.length, 1);
    assert.equal(cost.by_stage[0]?.stage, "planner");
    assert.ok(cost.usd > 0);
    assert.ok(cost.usd < 0.05);
  });

  it("sums mcp raw_count across query logs", () => {
    assert.equal(
      mcpHitsFromQueryLogs([{ raw_count: 40 }, { raw_count: 12 }, {}]),
      52,
    );
  });

  it("empty latency has null totals", () => {
    const l = emptyStageLatency();
    assert.equal(l.total_to_provisional_ms, null);
    assert.equal(l.planner_ms, 0);
  });

  it("laneMixFromRatings counts unlabeled separately", () => {
    const mix = laneMixFromRatings([
      { taste_rating: { lane: "usual" } },
      { taste_rating: { lane: "new" } },
      { taste_rating: { lane: "new" } },
      {},
    ]);
    assert.equal(mix.usual, 1);
    assert.equal(mix.new, 2);
    assert.equal(mix.adjacent, 0);
    assert.equal(mix.unlabeled, 1);
  });
});
