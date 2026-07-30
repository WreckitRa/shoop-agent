import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCastingMatrix,
  fallbackSlotsForMatrix,
  isPhotoIntentQuery,
  slotOverlapsWornPicks,
  tasteTagsOverlapTooMuch,
  STYLE_MIX_AXES,
} from "./outfit-grid-matrix";

describe("buildCastingMatrix", () => {
  it("locks 8 styleMix axes + Wildcard", () => {
    const matrix = buildCastingMatrix(["campus_life", "deep_in_career"]);
    assert.equal(matrix.length, 9);
    assert.deepEqual(
      matrix.slice(0, 8).map((c) => c.archetype),
      [...STYLE_MIX_AXES],
    );
    assert.equal(matrix[8]!.archetype, "Wildcard");
    assert.equal(matrix[0]!.lifestyleHint, "campus_life");
    assert.equal(matrix[1]!.lifestyleHint, "deep_in_career");
    assert.equal(matrix[2]!.lifestyleHint, "campus_life");
  });
});

describe("isPhotoIntentQuery", () => {
  it("requires photo-bias + garment combination", () => {
    assert.equal(isPhotoIntentQuery("women's dress"), false);
    assert.equal(isPhotoIntentQuery("women's blazer outfit"), false);
    assert.equal(
      isPhotoIntentQuery("women's blazer tailored trousers classic outfit"),
      true,
    );
    assert.equal(
      isPhotoIntentQuery("men's hoodie jeans comfort look"),
      true,
    );
  });
});

describe("tasteTagsOverlapTooMuch", () => {
  it("flags >50% jaccard overlap", () => {
    assert.equal(
      tasteTagsOverlapTooMuch(["a", "b", "c"], ["a", "b", "c", "d"]),
      true,
    );
    assert.equal(
      tasteTagsOverlapTooMuch(["knit", "casual"], ["evening", "formal"]),
      false,
    );
  });
});

describe("slotOverlapsWornPicks", () => {
  it("bans matching labels and overlapping tags", () => {
    assert.equal(
      slotOverlapsWornPicks(
        { label: "jeans + knit", tasteTags: ["x"] },
        ["jeans + knit"],
        [],
      ),
      true,
    );
    assert.equal(
      slotOverlapsWornPicks(
        { label: "airport cashmere", tasteTags: ["quiet-luxury", "travel"] },
        ["other"],
        ["quiet-luxury", "travel", "extra"],
      ),
      true,
    );
  });
});

describe("fallbackSlotsForMatrix", () => {
  it("gives androgynous its own table (not feminine)", () => {
    const fem = fallbackSlotsForMatrix({
      mode: "worn",
      genderPresentation: "feminine",
    });
    const andro = fallbackSlotsForMatrix({
      mode: "worn",
      genderPresentation: "androgynous",
    });
    assert.equal(fem.length, 9);
    assert.equal(andro.length, 9);
    assert.notEqual(fem[0]!.searchQuery, andro[0]!.searchQuery);
    assert.match(andro[0]!.searchQuery, /gender-neutral/i);
    assert.ok(andro.every((s) => isPhotoIntentQuery(s.searchQuery)));
    assert.ok(fem.every((s) => s.archetype !== undefined));
  });

  it("maps prefer-not-to-say to androgynous table", () => {
    const slots = fallbackSlotsForMatrix({
      mode: "aspirational",
      genderPresentation: "prefer not to say",
    });
    assert.match(slots[0]!.searchQuery, /gender-neutral/i);
  });
});
