import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPatchFromTastePicks,
  buildPatchFromTasteSwipes,
} from "./taste-persist";

describe("buildPatchFromTasteSwipes", () => {
  it("ignores neutral swipes and deduplicates normalized tags", () => {
    const patch = buildPatchFromTasteSwipes([
      {
        cardId: "neutral",
        swipe: "neutral",
        tasteTags: ["minimal"],
        category: "outfit",
      },
      {
        cardId: "liked",
        swipe: "like",
        tasteTags: ["Minimal", "minimal"],
        category: "outfit",
      },
    ]);

    assert.deepEqual(patch.tasteTags, [
      { tag: "minimal", polarity: "positive", category: "fashion" },
    ]);
  });

  it("keeps the same tag when polarity or category differs", () => {
    const patch = buildPatchFromTasteSwipes([
      {
        cardId: "fashion-like",
        swipe: "like",
        tasteTags: ["modern"],
        category: "outfit",
      },
      {
        cardId: "home-like",
        swipe: "like",
        tasteTags: ["modern"],
        category: "furniture",
      },
      {
        cardId: "fashion-dislike",
        swipe: "dislike",
        tasteTags: ["modern"],
        category: "outfit",
      },
    ]);

    assert.deepEqual(patch.tasteTags, [
      { tag: "modern", polarity: "positive", category: "fashion" },
      { tag: "modern", polarity: "positive", category: "home" },
      { tag: "modern", polarity: "negative", category: "fashion" },
    ]);
  });

  it("returns an empty patch for skip", () => {
    assert.deepEqual(buildPatchFromTasteSwipes([]), {});
  });
});

describe("buildPatchFromTastePicks", () => {
  it("maps worn/aspirational picks, brands, vetoes, and style mix", () => {
    const patch = buildPatchFromTastePicks({
      wornPicks: [
        { id: "1", label: "jeans + knit", tasteTags: ["casual", "knit"] },
        { id: "2", label: "all black", tasteTags: ["minimal"] },
      ],
      aspirationalPicks: [
        { id: "3", label: "quiet-luxury airport", tasteTags: ["quiet-luxury"] },
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
  });
});
