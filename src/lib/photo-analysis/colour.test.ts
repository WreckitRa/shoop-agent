import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CALIBRATE } from "./calibrate";
import {
  chroma,
  depthFromIta,
  estimateWhiteBalance,
  hueAngle,
  labToHex,
  rgbToLab,
  scaleChroma,
  undertoneFrom,
} from "./colour";
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

describe("colour A.1", () => {
  it("rgbToLab(255,255,255) is D65 white", () => {
    const lab = rgbToLab(255, 255, 255);
    assert.ok(Math.abs(lab.L - 100) < 0.01);
    assert.ok(Math.abs(lab.a) < 0.01);
    assert.ok(Math.abs(lab.b) < 0.01);
  });

  it("labToHex round-trips within 1 per channel", () => {
    const samples: Array<[number, number, number]> = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [12, 200, 90],
      [180, 110, 80],
      [40, 40, 40],
      [240, 200, 160],
      [30, 80, 200],
    ];
    for (let i = 0; i < 10; i++) {
      const r = (i * 37) % 256;
      const g = (i * 91) % 256;
      const b = (i * 173) % 256;
      samples.push([r, g, b]);
    }
    for (const [r, g, b] of samples) {
      const { r: r2, g: g2, b: b2 } = {
        r: Number.parseInt(labToHex(rgbToLab(r, g, b)).slice(1, 3), 16),
        g: Number.parseInt(labToHex(rgbToLab(r, g, b)).slice(3, 5), 16),
        b: Number.parseInt(labToHex(rgbToLab(r, g, b)).slice(5, 7), 16),
      };
      assert.ok(Math.abs(r2 - r) <= 1, `r ${r}→${r2}`);
      assert.ok(Math.abs(g2 - g) <= 1, `g ${g}→${g2}`);
      assert.ok(Math.abs(b2 - b) <= 1, `b ${b}→${b2}`);
    }
  });

  it("hueAngle covers all four quadrants as 0..360", () => {
    const red = hueAngle(rgbToLab(255, 0, 0));
    const yellow = hueAngle(rgbToLab(255, 255, 0));
    const green = hueAngle(rgbToLab(0, 255, 0));
    const blue = hueAngle(rgbToLab(0, 0, 255));
    for (const h of [red, yellow, green, blue]) {
      assert.ok(h >= 0 && h < 360);
    }
    assert.ok(red < 50 || red > 330);
    assert.ok(yellow > 50 && yellow < 130);
    assert.ok(green > 100 && green < 200);
    assert.ok(blue > 200 && blue < 320);
  });

  it("estimateWhiteBalance: grey is clean, red*1.3 is risk", () => {
    const grey = estimateWhiteBalance(solid(40, 40, 128, 128, 128));
    assert.ok(grey.cast < 0.01);
    assert.equal(grey.risk, false);

    const warm = estimateWhiteBalance(solid(40, 40, 166, 128, 128));
    assert.equal(warm.risk, true);
  });

  it("scaleChroma(hex, 0) is near-neutral", () => {
    const hex = scaleChroma("#c87850", 0);
    const { r, g, b } = {
      r: Number.parseInt(hex.slice(1, 3), 16),
      g: Number.parseInt(hex.slice(3, 5), 16),
      b: Number.parseInt(hex.slice(5, 7), 16),
    };
    assert.ok(chroma(rgbToLab(r, g, b)) < 1);
  });

  it("olive branch runs before warm/cool", () => {
    const oliveLab = { L: 60, a: 6, b: 22 };
    assert.ok(oliveLab.a / oliveLab.b < CALIBRATE.oliveAbRatio);
    assert.equal(undertoneFrom(oliveLab), "olive");
    assert.equal(undertoneFrom({ L: 70, a: 10, b: 20 }), "warm");
    assert.equal(undertoneFrom({ L: 70, a: 18, b: 8 }), "cool");
  });

  it("depth bands follow ITA cuts", () => {
    assert.equal(depthFromIta(60), "very light");
    assert.equal(depthFromIta(45), "light");
    assert.equal(depthFromIta(30), "intermediate");
    assert.equal(depthFromIta(15), "tan");
    assert.equal(depthFromIta(0), "brown");
    assert.equal(depthFromIta(-40), "deep");
  });
});
