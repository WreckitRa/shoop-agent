import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bodyMeasures } from "./geometry";
import { backgroundModel, largestComponent, rowProfile, silhouetteMask } from "./segment";
import type { ImagePixels } from "./types";

function makeImage(w: number, h: number): ImagePixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 250;
    data[i * 4 + 1] = 250;
    data[i * 4 + 2] = 250;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function fillCentered(
  img: ImagePixels,
  y: number,
  width: number,
  rgb: [number, number, number],
) {
  const cx = Math.floor(img.width / 2);
  const half = Math.floor(width / 2);
  for (let x = cx - half; x <= cx + half; x++) {
    if (x < 0 || x >= img.width) continue;
    const i = (y * img.width + x) * 4;
    img.data[i] = rgb[0];
    img.data[i + 1] = rgb[1];
    img.data[i + 2] = rgb[2];
  }
}

function fillLegs(img: ImagePixels, y: number, legW: number, gap: number) {
  const cx = Math.floor(img.width / 2);
  const rgb: [number, number, number] = [20, 20, 20];
  for (const sign of [-1, 1]) {
    const mid = cx + sign * Math.ceil(gap / 2 + legW / 2);
    for (let x = mid - Math.floor(legW / 2); x <= mid + Math.floor(legW / 2); x++) {
      if (x < 0 || x >= img.width) continue;
      const i = (y * img.width + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
    }
  }
}

function measureFrom(img: ImagePixels) {
  const bg = backgroundModel(img);
  const mask = silhouetteMask(img, bg);
  const comp = largestComponent(mask, img.width, img.height);
  const rp = rowProfile(comp.labels, comp.best, img.width, img.height);
  const faceH = Math.round((rp.y1 - rp.y0 + 1) * 0.16);
  return bodyMeasures(rp, img.height, faceH, rp.y0 + faceH, bg.spread, true);
}

function hourglass(): ImagePixels {
  const img = makeImage(80, 220);
  for (let y = 8; y < 30; y++) fillCentered(img, y, 16, [20, 20, 20]);
  for (let y = 30; y < 70; y++) {
    const t = (y - 30) / 40;
    fillCentered(img, y, Math.round(42 - t * 8), [20, 20, 20]);
  }
  for (let y = 70; y < 110; y++) {
    const t = (y - 70) / 40;
    fillCentered(img, y, Math.round(22 + t * 6), [20, 20, 20]);
  }
  for (let y = 110; y < 135; y++) fillCentered(img, y, 46, [20, 20, 20]);
  for (let y = 135; y < 212; y++) fillLegs(img, y, 12, 10);
  return img;
}

function rectangle(): ImagePixels {
  const img = makeImage(80, 220);
  for (let y = 8; y < 30; y++) fillCentered(img, y, 16, [20, 20, 20]);
  for (let y = 30; y < 135; y++) fillCentered(img, y, 36, [20, 20, 20]);
  for (let y = 135; y < 212; y++) fillLegs(img, y, 12, 8);
  return img;
}

function invertedTriangle(): ImagePixels {
  const img = makeImage(80, 220);
  for (let y = 8; y < 24; y++) fillCentered(img, y, 16, [20, 20, 20]);
  for (let y = 24; y < 90; y++) fillCentered(img, y, 54, [20, 20, 20]);
  for (let y = 90; y < 135; y++) {
    const t = (y - 90) / 45;
    fillCentered(img, y, Math.round(40 - t * 14), [20, 20, 20]);
  }
  for (let y = 135; y < 212; y++) fillLegs(img, y, 10, 12);
  return img;
}

describe("body geometry", () => {
  it("hourglass has a deep waist relative to hip", () => {
    const m = measureFrom(hourglass());
    assert.equal(m.available, true);
    assert.notEqual(m.waistOverHip.value, "unknown");
    assert.notEqual(m.waistDepth.value, "unknown");
    if (m.waistOverHip.value !== "unknown") {
      assert.ok(m.waistOverHip.value < 0.8, String(m.waistOverHip.value));
    }
    if (m.waistDepth.value !== "unknown") {
      assert.ok(m.waistDepth.value > 0.12, String(m.waistDepth.value));
    }
  });

  it("rectangle stays close to 1.0 waist/hip", () => {
    const m = measureFrom(rectangle());
    assert.equal(m.available, true);
    if (m.waistOverHip.value !== "unknown") {
      assert.ok(m.waistOverHip.value > 0.82, String(m.waistOverHip.value));
    }
    if (m.waistDepth.value !== "unknown") {
      assert.ok(m.waistDepth.value < 0.18, String(m.waistDepth.value));
    }
  });

  it("inverted triangle has shoulders wider than hips", () => {
    const m = measureFrom(invertedTriangle());
    assert.equal(m.available, true);
    if (m.shoulderOverHip.value !== "unknown") {
      assert.ok(m.shoulderOverHip.value > 1.05, String(m.shoulderOverHip.value));
    }
  });
});
