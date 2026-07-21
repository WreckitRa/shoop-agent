import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPatchFromTasteSwipes } from "./taste-persist";

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
