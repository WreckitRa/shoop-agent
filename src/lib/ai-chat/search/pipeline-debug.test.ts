import assert from "node:assert/strict";
import test from "node:test";
import {
  availableDropStageFilters,
  countJourneyRowsForDropFilter,
  journeyRowMatchesDropFilter,
  pipelineDebugForPersist,
  slotRowsFromCuratedPicks,
} from "./pipeline-debug";
import type { PipelineJourneyRow, PipelineSlotRow } from "./pipeline-debug";
import type { CuratedPick } from "../types";

function row(
  id: string,
  outcome: PipelineJourneyRow["outcome"],
  dropStage?: PipelineJourneyRow["dropStage"],
  dropReason?: string,
): PipelineJourneyRow {
  return {
    product: { id, title: id, store: null, imageUrl: null },
    outcome,
    furthestStage: "Verified",
    dropStage,
    dropReason,
  };
}

test("pipelineDebugForPersist strips catalogById but keeps verified getProduct", () => {
  const slim = pipelineDebugForPersist({
    version: 1,
    searchKey: "sk-1",
    query: "boots",
    ts: Date.now(),
    catalogFetched: [],
    fetched: [],
    preVerify: [],
    verified: [{ id: "v1", title: "Verified", store: null, imageUrl: null }],
    verifyDrops: [],
    verifyNotAttempted: [],
    listingHygiene: [],
    finalists: [],
    triage: [],
    headToHead: [],
    slots: [],
    fallbacks: [],
    method: "tier_judge",
    catalogById: { a: { id: "a" }, v1: { id: "v1" } },
    getProductById: { v1: { id: "v1", title: "Live" } },
    journey: [],
    allDropped: [],
    onScreen: [],
    journeySummary: {
      catalogFetched: 0,
      afterPoolFilters: 0,
      preVerify: 0,
      verified: 1,
      onRack: 0,
      dropped: 0,
      stalled: 0,
      byDropStage: {},
    },
    poolFilterDrops: [],
    scoringConstraintDrops: [],
    slottingDrops: [],
  });
  assert.deepEqual(slim.catalogById, {});
  assert.deepEqual(slim.getProductById, { v1: { id: "v1", title: "Live" } });
});

test("journeyRowMatchesDropFilter groups size drops", () => {
  const sizePrune = row("a", "dropped", "pre_verify_prune", "No size match");
  const sizeExact = row("b", "dropped", "size_exact", "Exact size unavailable");
  const judge = row("c", "dropped", "judge_omission", "Lost head-to-head");

  assert.equal(journeyRowMatchesDropFilter(sizePrune, "size"), true);
  assert.equal(journeyRowMatchesDropFilter(sizeExact, "size"), true);
  assert.equal(journeyRowMatchesDropFilter(judge, "size"), false);
  assert.equal(journeyRowMatchesDropFilter(judge, "judge_omission"), true);
});

test("slotRowsFromCuratedPicks drops slots removed after brand composition", () => {
  const prior: PipelineSlotRow[] = [
    {
      product: { id: "a", title: "A", store: null, imageUrl: null },
      slot: "shoop_pick",
      whyHere: "Hero",
      source: "tier_judge",
    },
    {
      product: { id: "b", title: "B", store: null, imageUrl: null },
      slot: "gallery",
      whyHere: "Gallery",
      source: "tier_judge",
    },
  ];
  const picks = [
    { id: "a", slot: "shoop_pick", title: "A" },
  ] as CuratedPick[];
  const rows = slotRowsFromCuratedPicks(picks, prior, (id) =>
    id === "a"
      ? { id: "a", title: "A", store: null, imageUrl: null }
      : undefined,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.product.id, "a");
});

test("availableDropStageFilters only returns filters with matches", () => {
  const rows = [
    row("a", "dropped", "pre_verify_prune"),
    row("b", "dropped", "judge_omission"),
    row("c", "on_rack"),
  ];
  const filters = availableDropStageFilters(rows);
  assert.deepEqual(filters, ["all", "size", "judge_omission"]);
  assert.equal(countJourneyRowsForDropFilter(rows, "size"), 1);
  assert.equal(countJourneyRowsForDropFilter(rows, "judge_omission"), 1);
});
