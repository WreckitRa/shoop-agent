import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutfitGridDeck,
  countInhouseCoverage,
  scoreLookForContext,
  selectInhouseDeck,
} from "./outfit-grid-inhouse";
import { buildCastingMatrix, STYLE_MIX_AXES } from "./outfit-grid-matrix";
import { INHOUSE_OUTFIT_LOOKS } from "./outfit-style-catalog";

describe("inhouse outfit catalog", () => {
  it("has enough looks for key genders (mode-agnostic library)", () => {
    assert.ok(INHOUSE_OUTFIT_LOOKS.length >= 36);
    assert.ok(countInhouseCoverage({ genderPresentation: "feminine" }) >= 9);
    assert.ok(countInhouseCoverage({ genderPresentation: "masculine" }) >= 9);
  });

  it("fills 9 unique cells with images from the full style pool", () => {
    const deck = selectInhouseDeck({
      mode: "worn",
      genderPresentation: "masculine",
      styleEra: "30s,23_29",
      lifestyleTags: ["deep_in_career"],
      valuePhilosophy: "premium",
    });
    assert.equal(deck.length, 9);
    assert.deepEqual(
      deck.map((c) => c.archetype),
      [...STYLE_MIX_AXES, "Wildcard"],
    );
    assert.ok(deck.every((c) => c.imageUrl));
    const ids = new Set(deck.map((c) => c.id));
    assert.equal(ids.size, 9);
  });

  it("does not recommend feminine-only looks to masculine shoppers", () => {
    const deck = selectInhouseDeck({
      mode: "worn",
      genderPresentation: "masculine",
      styleEra: "30s",
    });
    assert.equal(deck.length, 9);
    for (const card of deck) {
      const look = INHOUSE_OUTFIT_LOOKS.find((l) => l.id === card.id);
      assert.ok(look, card.id);
      assert.ok(
        !look.genders.includes("feminine") ||
          look.genders.includes("masculine"),
        `feminine-only on man deck: ${card.id} [${look.genders.join(",")}]`,
      );
    }
  });

  it("can surface the same style pool for worn and wanted", () => {
    const worn = selectInhouseDeck({
      mode: "worn",
      genderPresentation: "feminine",
      styleEra: "30s",
    });
    const wanted = selectInhouseDeck({
      mode: "aspirational",
      genderPresentation: "feminine",
      styleEra: "30s",
      wornLookIds: worn.map((c) => c.id),
    });
    assert.equal(worn.length, 9);
    assert.equal(wanted.length, 9);
    const wornIds = new Set(worn.map((c) => c.id));
    for (const c of wanted) {
      assert.ok(!wornIds.has(c.id));
    }
  });


  it("campus-era masculine worn decks surface hoodie / jogger energy", () => {
    const deck = selectInhouseDeck({
      mode: "worn",
      genderPresentation: "masculine",
      styleEra: "18_22",
    });
    const hay = deck
      .map((c) => `${c.label} ${c.tasteTags.join(" ")}`)
      .join(" ")
      .toLowerCase();
    assert.ok(
      /hoodie|jogger|campus|tee|denim/.test(hay),
      `expected laid-back campus looks, got: ${hay}`,
    );
  });

  it("scores hoodie/joggers above a blazer for campus + laid-back context", () => {
    const cell = buildCastingMatrix(["campus_life"])[5]!; // Sporty
    const hoodie = INHOUSE_OUTFIT_LOOKS.find((l) => l.id === "m-w-sporty-01")!;
    const blazer = INHOUSE_OUTFIT_LOOKS.find((l) => l.id === "m-w-classic-01")!;
    const hoodieScore = scoreLookForContext(
      hoodie,
      {
        mode: "worn",
        genderPresentation: "masculine",
        styleEra: "18_22",
        lifestyleTags: ["campus_life"],
        valuePhilosophy: "best_value",
      },
      cell,
    );
    const blazerScore = scoreLookForContext(
      blazer,
      {
        mode: "worn",
        genderPresentation: "masculine",
        styleEra: "18_22",
        lifestyleTags: ["campus_life"],
        valuePhilosophy: "best_value",
      },
      cell,
    );
    assert.ok(hoodieScore.total > blazerScore.total);
    assert.ok(hoodieScore.energy > blazerScore.energy);
  });

  it("scores era + spend matches higher", () => {
    const cell = buildCastingMatrix()[4]!; // Classic
    const look = INHOUSE_OUTFIT_LOOKS.find(
      (l) =>
        l.id === "m-w-classic-01" ||
        (l.archetypes[0] === "Classic" && l.genders.includes("masculine")),
    )!;
    const hit = scoreLookForContext(
      look,
      {
        mode: "worn",
        genderPresentation: "masculine",
        styleEra: "40s",
        valuePhilosophy: "premium",
        lifestyleTags: ["deep_in_career"],
      },
      cell,
    );
    const miss = scoreLookForContext(
      look,
      {
        mode: "worn",
        genderPresentation: "masculine",
        styleEra: "13_14",
        valuePhilosophy: "deal_hunter",
        lifestyleTags: ["campus_life"],
      },
      cell,
    );
    assert.ok(hit.total > miss.total);
  });

  it("avoids worn label overlap on aspirational", () => {
    const wornLabels = ["quiet-luxury airport", "quiet-luxury travel"];
    const wornTasteTags = ["quiet-luxury", "travel", "cashmere"];
    const deck = selectInhouseDeck({
      mode: "aspirational",
      genderPresentation: "feminine",
      styleEra: "30s",
      wornLabels,
      wornTasteTags,
    });
    assert.equal(deck.length, 9);
    for (const card of deck) {
      const label = card.label.toLowerCase();
      assert.ok(!wornLabels.some((w) => label === w.toLowerCase()));
    }
  });

  it("buildOutfitGridDeck is sync-compatible async", async () => {
    const page = await buildOutfitGridDeck({
      mode: "worn",
      genderPresentation: "androgynous",
      styleEra: "23_29",
    });
    assert.equal(page.deck.length, 9);
    assert.ok(page.deck.filter((c) => c.imageUrl).length >= 8);
    assert.equal(typeof page.hasMore, "boolean");
  });

  it("See more pages exclude already-shown styles", async () => {
    const first = await buildOutfitGridDeck({
      mode: "worn",
      genderPresentation: "feminine",
      styleEra: "30s",
    });
    assert.equal(first.deck.length, 9);
    assert.equal(first.hasMore, true);

    const second = await buildOutfitGridDeck({
      mode: "worn",
      genderPresentation: "feminine",
      styleEra: "30s",
      excludeLookIds: first.deck.map((c) => c.id),
    });
    assert.ok(second.deck.length >= 1);
    const firstIds = new Set(first.deck.map((c) => c.id));
    for (const card of second.deck) {
      assert.ok(!firstIds.has(card.id));
      assert.ok(card.imageUrl);
    }
  });
});
