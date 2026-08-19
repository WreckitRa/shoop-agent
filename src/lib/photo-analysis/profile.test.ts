import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeProfile } from "./profile";
import { coercePhotoProfile } from "./schema";
import type { ImagePixels } from "./types";

function solid(w: number, h: number, r: number, g: number, b: number): ImagePixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function portrait(): ImagePixels {
  const img = solid(200, 260, 245, 245, 248);
  const cx = 100;
  const cy = 110;
  for (let y = 40; y < 190; y++) {
    for (let x = 40; x < 160; x++) {
      const dx = (x - cx) / 48;
      const dy = (y - cy) / 72;
      if (dx * dx + dy * dy <= 1) {
        const i = (y * 200 + x) * 4;
        img.data[i] = 180;
        img.data[i + 1] = 110;
        img.data[i + 2] = 80;
      }
    }
  }
  return img;
}

describe("computeProfile", () => {
  it("marks a blank frame as no face", () => {
    const p = computeProfile(solid(500, 500, 240, 240, 240));
    assert.equal(p.source, "spec");
    assert.equal(p.quality.facePresent, false);
    assert.equal(p.colour.skin.value, "unknown");
    assert.equal(p.body.available, false);
    assert.ok(!("height" in p) && !("weight" in p));
  });

  it("samples colour from a skin-coloured face", () => {
    const p = computeProfile(portrait());
    assert.equal(p.quality.facePresent, true);
    assert.notEqual(p.colour.skin.value, "unknown");
    assert.notEqual(p.colour.undertone.value, "unknown");
    assert.notEqual(p.face.faceLW.value, "unknown");
  });
});

describe("coercePhotoProfile", () => {
  it("fills unknown for missing GPT fields and forces source gpt", () => {
    const p = coercePhotoProfile(
      {
        source: "spec",
        colour: {
          undertone: { value: "olive", confidence: 0.7 },
        },
        notes: ["warm tungsten"],
      },
      "gpt-5.4-pro",
    );
    assert.equal(p.source, "gpt");
    assert.equal(p.engine, "gpt-5.4-pro");
    assert.equal(p.colour.undertone.value, "olive");
    assert.equal(p.colour.skin.value, "unknown");
    assert.equal(p.body.available, false);
    assert.deepEqual(p.notes, ["warm tungsten"]);
  });
});
