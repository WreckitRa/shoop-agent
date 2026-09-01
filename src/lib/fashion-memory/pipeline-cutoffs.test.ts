import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NORMALIZE_HARD_MS, PLANNER_HARD_MS } from "./pipeline-cutoffs";

describe("pipeline hang-safety defaults", () => {
  it("planner and normalize hard cutoffs default to 15s", () => {
    if (
      process.env.FASHION_PLANNER_HARD_MS ||
      process.env.FASHION_NORMALIZE_HARD_MS
    ) {
      return;
    }
    assert.equal(PLANNER_HARD_MS, 15_000);
    assert.equal(NORMALIZE_HARD_MS, 15_000);
  });
});
