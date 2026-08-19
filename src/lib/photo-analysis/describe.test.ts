import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeBody, describeColour, describeFace } from "./describe";
import { knownMeasure, unknownMeasure, emptyBody } from "./types";

describe("describeColour", () => {
  it("turns the bakeoff numbers into plain sentences", () => {
    const out = describeColour({
      skin: knownMeasure({ L: 49.3, a: 12.4, b: 14.7 }, 0.86),
      hair: knownMeasure({ L: 16.3, a: 0.9, b: 0.3 }, 0.66),
      iris: knownMeasure({ L: 57.6, a: 14.7, b: 12.9 }, 0.45),
      ita: knownMeasure(-2.73, 0.86),
      hue: knownMeasure(49.76, 0.86),
      chroma: knownMeasure(19.21, 0.86),
      abRatio: knownMeasure(0.85, 0.86),
      depth: knownMeasure("brown", 0.86),
      undertone: knownMeasure("neutral", 0.7),
      contrast: knownMeasure("medium", 0.85),
      contrastValue: knownMeasure(32.98, 0.85),
      whiteBalance: {
        gainR: 1,
        gainB: 1,
        cast: 0.02,
        risk: false,
        neutralCount: 200,
      },
    });
    assert.ok(out.lines.some((l) => /Neutral undertone/i.test(l)));
    assert.ok(out.lines.some((l) => /Medium-deep skin/.test(l)));
    assert.ok(out.lines.some((l) => /Medium contrast/.test(l)));
    assert.ok(out.lines.some((l) => /Very dark hair/.test(l)));
    assert.ok(out.lines.every((l) => !/Lab|ITA|a\/b|ΔL/.test(l)));
  });
});

describe("describeFace", () => {
  it("does not leak ratios", () => {
    const text = describeFace({
      faceLW: knownMeasure(1.28, 0.8),
      jawCheek: knownMeasure(0.63, 0.8),
      foreheadCheek: knownMeasure(0.71, 0.8),
      chinCheek: knownMeasure(0.54, 0.8),
      neckLength: knownMeasure(0.15, 0.45),
      shape: knownMeasure("round", 0.8),
    });
    assert.match(text, /round face/i);
    assert.match(text, /longer than it is wide/i);
    assert.match(text, /jaw tapers/i);
    assert.match(text, /shorter/i);
    assert.doesNotMatch(text, /1\.28|0\.63|L\/W/);
  });
});

describe("describeBody", () => {
  it("explains a portrait instead of dumping ratios", () => {
    const text = describeBody(emptyBody("Not full-length — body group unavailable"));
    assert.match(text, /full-length/i);
    assert.doesNotMatch(text, /unavailableReason|waistPct/);
  });

  it("skips unknown body", () => {
    const text = describeBody({
      ...emptyBody(),
      available: true,
      shoulderOverHip: knownMeasure(1.12, 0.84),
      waistOverHip: knownMeasure(0.72, 0.84),
      waistDepth: knownMeasure(0.22, 0.84),
      torsoOverLeg: knownMeasure(0.88, 0.84),
      legPctHeight: knownMeasure(0.54, 0.84),
      headsTall: unknownMeasure(),
    });
    assert.match(text, /shoulders wider/i);
    assert.match(text, /nipped waist/i);
  });
});
