import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPatchFromTastePicks, honestyPreferenceForSave } from "./taste-persist";

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
      comfort: ["no heels"],
      compliments: ["Polished", "Expensive"],
      honestyPreference: "straight",
      valuePhilosophy: "premium",
      styleFriction: "everything looks unfinished",
      styleBecome: "more tailored, like I chose this",
    });

    assert.ok(patch.tasteTags?.some((t) => t.category === "worn"));
    assert.ok(patch.tasteTags?.some((t) => t.category === "aspirational"));
    assert.ok(patch.tasteTags?.some((t) => t.category === "compliment"));
    assert.deepEqual(
      patch.tasteTags
        ?.filter((t) => t.category === "worn")
        .map((t) => t.tag)
        .sort(),
      ["all black", "jeans + knit"],
    );
    assert.equal(
      patch.tasteTags?.filter((t) => t.category === "worn").length,
      2,
    );
    assert.deepEqual(
      patch.brands?.map((b) => b.brand).sort(),
      ["COS", "FastBrand", "Zara"],
    );
    assert.equal(patch.hardNegatives?.length, 3);
    assert.ok(
      patch.hardNegatives?.some(
        (h) => h.note === "comfort" && h.value === "no heels",
      ),
    );
    assert.deepEqual(patch.sizing?.sensitivities, ["no heels"]);
    assert.equal(patch.profile?.honestyPreference, "3");
    assert.equal(patch.profile?.valuePhilosophy, "premium");
    assert.equal(patch.profile?.styleFriction, "everything looks unfinished");
    assert.equal(patch.profile?.styleBecome, "more tailored, like I chose this");
    assert.ok(patch.profile?.styleMix);
    assert.equal(patch.profile?.complimentPreferences?.length, 2);
    const axisLabels = patch.profile?.styleMix?.axes.map((a) => a.label) ?? [];
    assert.ok(axisLabels.includes("Sporty") || axisLabels.includes("Minimal"));
  });

  it("maps legacy gentle honesty onto 1", () => {
    const patch = buildPatchFromTastePicks({
      honestyPreference: "gentle",
    });
    assert.equal(patch.profile?.honestyPreference, "1");
  });

  it("does not stamp honesty until the honesty step is locked", () => {
    const worn = buildPatchFromTastePicks({
      wornPicks: [{ id: "1", label: "jeans", archetype: "Sporty" }],
    });
    assert.equal(worn.profile?.honestyPreference, undefined);
    assert.equal(honestyPreferenceForSave("worn", ""), undefined);
    assert.equal(honestyPreferenceForSave("nolist", "5"), undefined);
    assert.equal(honestyPreferenceForSave("final", ""), "3");
    assert.equal(honestyPreferenceForSave("final", "5"), "5");
    assert.equal(honestyPreferenceForSave("final", "2"), "2");
    assert.equal(honestyPreferenceForSave("final", "4"), "4");
  });
});
