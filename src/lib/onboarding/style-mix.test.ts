import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeStyleMix, formatStyleMixNarration } from "./style-mix";

describe("computeStyleMix", () => {
  it("weights worn picks more than aspirational", () => {
    const mix = computeStyleMix({
      wornLabels: ["jeans + knit", "athleisure", "all black"],
      aspirationalLabels: ["quiet-luxury airport", "French-girl café"],
      compliments: ["Polished", "Expensive"],
    });
    assert.ok(mix.axes.length >= 2);
    assert.equal(
      mix.axes.reduce((sum, a) => sum + a.percent, 0),
      100,
    );
    assert.equal(mix.headingToward, "Polished");
    assert.equal(mix.headingPercent, 25);
  });

  it("falls back to Minimal/Classic/Parisian when empty", () => {
    const mix = computeStyleMix({});
    assert.deepEqual(
      mix.axes.map((a) => a.label).sort(),
      ["Classic", "Minimal", "Parisian"].sort(),
    );
  });
});

describe("formatStyleMixNarration", () => {
  it("includes the shopper name", () => {
    const copy = formatStyleMixNarration(
      {
        axes: [
          { label: "Parisian", percent: 50 },
          { label: "Minimal", percent: 30 },
          { label: "Romantic", percent: 20 },
        ],
        headingToward: "Polished",
        headingPercent: 25,
      },
      "Dania",
    );
    assert.match(copy.title, /Dania/);
    assert.match(copy.body, /50% Parisian/);
    assert.match(copy.locked, /better we know you/i);
  });
});
