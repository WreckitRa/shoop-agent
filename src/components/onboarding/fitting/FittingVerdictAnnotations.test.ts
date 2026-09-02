import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VERDICT_ANNO_REGIONS } from "./FittingVerdictAnnotations";

describe("verdict twin annotations", () => {
  it("pins face, shoulders, body, and legs on the standing twin", () => {
    assert.deepEqual(
      VERDICT_ANNO_REGIONS.map((r) => r.id),
      ["face", "shoulders", "body", "legs"],
    );
    for (const r of VERDICT_ANNO_REGIONS) {
      assert.ok(r.x > 0 && r.x < 100);
      assert.ok(r.y > 0 && r.y < 80);
      assert.ok(r.phrases.length >= 3);
      assert.ok(r.phrases.every((p) => p.length > 0 && p.length <= 40));
    }
    assert.equal(VERDICT_ANNO_REGIONS[0]!.y < VERDICT_ANNO_REGIONS[1]!.y, true);
    assert.equal(VERDICT_ANNO_REGIONS[1]!.y < VERDICT_ANNO_REGIONS[2]!.y, true);
    assert.equal(VERDICT_ANNO_REGIONS[2]!.y < VERDICT_ANNO_REGIONS[3]!.y, true);
  });
});
