import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSkin, largestComponent, rowProfile } from "./segment";

describe("segment", () => {
  it("isSkin accepts Kovac skin and rejects blue", () => {
    assert.equal(isSkin(180, 110, 80), true);
    assert.equal(isSkin(20, 40, 200), false);
  });

  it("largestComponent uses an explicit stack and tracks second size", () => {
    const w = 8;
    const h = 8;
    const mask = new Uint8Array(w * h);
    for (let y = 1; y <= 4; y++) {
      for (let x = 1; x <= 4; x++) mask[y * w + x] = 1;
    }
    mask[6 * w + 6] = 1;
    mask[6 * w + 7] = 1;
    const { best, size, secondSize } = largestComponent(mask, w, h);
    assert.ok(best > 0);
    assert.equal(size, 16);
    assert.equal(secondSize, 2);
  });

  it("rowProfile counts separate horizontal runs", () => {
    const w = 10;
    const h = 3;
    const labels = new Int32Array(w * h);
    for (let x = 1; x <= 3; x++) labels[w + x] = 1;
    for (let x = 6; x <= 8; x++) labels[w + x] = 1;
    const rp = rowProfile(labels, 1, w, h);
    assert.equal(rp.runs[1], 2);
    assert.equal(rp.rowWidth[1], 8);
    assert.equal(rp.x0, 1);
    assert.equal(rp.x1, 8);
  });
});
