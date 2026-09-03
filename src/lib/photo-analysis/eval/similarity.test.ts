import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maxOffDiagonal,
  pairwiseMatrix,
  tokenJaccard,
} from "./similarity";

describe("tokenJaccard", () => {
  it("is 1 on identical text and near 0 on disjoint", () => {
    assert.equal(tokenJaccard("warm knit near the face", "warm knit near the face"), 1);
    assert.ok(tokenJaccard("olive overshirt for video calls", "sequin mini for nights out") < 0.2);
  });

  it("reports the max off-diagonal pair", () => {
    const m = pairwiseMatrix(
      ["a", "b", "c"],
      ["warm knit near face", "warm knit at the collar", "sequin nights"],
    );
    assert.equal(m.a?.a, 1);
    assert.ok(maxOffDiagonal(m) < 1);
    assert.ok(maxOffDiagonal(m) > 0);
  });
});
