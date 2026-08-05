import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPatchFromTastePicks } from "./taste-persist";

describe("buildPatchFromTastePicks", () => {
  it("maps worn/aspirational picks, brands, vetoes, and style mix", () => {
    const patch = buildPatchFromTastePicks({
      wornPicks: [
        {
          id: "1",
          label: "jeans + knit",
          tasteTags: ["casual", "knit"],
          archetype: "Sporty",
        },
        {
          id: "2",
          label: "all black",
          tasteTags: ["minimal"],
          archetype: "Minimal",
        },
      ],
      aspirationalPicks: [
        {
          id: "3",
          label: "quiet-luxury airport",
          tasteTags: ["quiet-luxury"],
          archetype: "Parisian",
        },
      ],
      brandLikes: ["COS", "Zara"],
      brandAvoids: ["FastBrand"],
      hardAvoids: ["loud logos", "neon"],
      compliments: ["Polished", "Expensive"],
      honestyPreference: "straight",
      valuePhilosophy: "premium",
    });

    assert.ok(patch.tasteTags?.some((t) => t.category === "worn"));
    assert.ok(patch.tasteTags?.some((t) => t.category === "aspirational"));
    assert.ok(patch.tasteTags?.some((t) => t.category === "compliment"));
    assert.deepEqual(
      patch.brands?.map((b) => b.brand).sort(),
      ["COS", "FastBrand", "Zara"],
    );
    assert.equal(patch.hardNegatives?.length, 2);
    assert.equal(patch.profile?.honestyPreference, "straight");
    assert.equal(patch.profile?.valuePhilosophy, "premium");
    assert.ok(patch.profile?.styleMix);
    assert.equal(patch.profile?.complimentPreferences?.length, 2);
    const axisLabels = patch.profile?.styleMix?.axes.map((a) => a.label) ?? [];
    assert.ok(axisLabels.includes("Sporty") || axisLabels.includes("Minimal"));
  });
});
