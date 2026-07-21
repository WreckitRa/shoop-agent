import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapWithConcurrency } from "./taste-catalog";

describe("mapWithConcurrency", () => {
  it("bounds active catalog work and preserves input order", async () => {
    let active = 0;
    let peak = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 10;
    });

    assert.equal(peak, 2);
    assert.deepEqual(values, [10, 20, 30, 40, 50]);
  });

  it("keeps partial results when one slot fails", async () => {
    const values = await mapWithConcurrency([1, 2, 3], 3, async (value) => {
      if (value === 2) throw new Error("catalog unavailable");
      return value;
    });

    assert.deepEqual(values, [1, null, 3]);
  });
});
