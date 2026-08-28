import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  suggestBrandAvoids,
  suggestBrandLikes,
  suggestComfortLines,
  suggestStyleVetoes,
} from "./loves-vetoes-suggest";

describe("loves-vetoes-suggest", () => {
  it("leans premium/minimal brands for career + premium spend", () => {
    const brands = suggestBrandLikes({
      genderPresentation: "masculine",
      styleEra: "30s",
      lifestyleTags: ["deep_in_career"],
      valuePhilosophy: "premium",
      wornLabels: ["blazer day", "oxford shirt"],
      aspirationalLabels: ["quiet-luxury airport"],
    });
    assert.ok(brands.length >= 4);
    assert.ok(
      brands.some((b) =>
        ["COS", "Theory", "Todd Snyder", "Asket", "Massimo Dutti"].includes(b),
      ),
      `expected career/premium brands, got ${brands.join(", ")}`,
    );
  });

  it("does not suggest womenswear brands or heels to a masculine shopper", () => {
    const ctx = {
      genderPresentation: "masculine",
      styleEra: "30s",
      lifestyleTags: ["deep_in_career"],
      valuePhilosophy: "premium",
      wornLabels: ["blazer day"],
      aspirationalLabels: ["quiet-luxury airport"],
    };
    const brands = suggestBrandLikes(ctx);
    const vetoes = suggestStyleVetoes(ctx);
    const comfort = suggestComfortLines(ctx).map((o) => o.value);
    const avoids = suggestBrandAvoids(ctx);

    for (const b of ["Sézane", "Reformation", "Aritzia", "Madewell", "Mango"]) {
      assert.ok(!brands.includes(b), `masculine likes leaked ${b}`);
    }
    assert.ok(!comfort.includes("no heels"));
    assert.ok(!comfort.includes("nothing sheer"));
    assert.ok(comfort.includes("no skinny jeans") || comfort.includes("no tight fits"));
    assert.ok(!vetoes.includes("see-through fabrics"));
    assert.ok(!vetoes.includes("party sequins day-to-day"));
    assert.ok(!avoids.includes("Fashion Nova"));
  });

  it("does not suggest menswear houses to a feminine shopper", () => {
    const brands = suggestBrandLikes({
      genderPresentation: "feminine",
      styleEra: "30s",
      valuePhilosophy: "premium",
      lifestyleTags: ["deep_in_career"],
    });
    assert.ok(!brands.includes("Todd Snyder"));
    assert.ok(!brands.includes("Buck Mason"));
    assert.ok(!brands.includes("Asket"));
    const comfort = suggestComfortLines({
      genderPresentation: "feminine",
    }).map((o) => o.value);
    assert.ok(comfort.includes("no heels"));
    assert.ok(!comfort.includes("no skinny jeans"));
  });

  it("suggests logo/neon vetoes for quiet-luxury aspirational picks", () => {
    const vetoes = suggestStyleVetoes({
      genderPresentation: "feminine",
      valuePhilosophy: "luxury",
      aspirationalLabels: ["quiet-luxury airport", "minimalist gallery"],
      wornTasteTags: ["minimal", "classic"],
    });
    assert.ok(vetoes.includes("loud logos") || vetoes.includes("neon"));
  });

  it("suggests fast-fashion avoid brands for luxury shoppers", () => {
    const avoids = suggestBrandAvoids({
      valuePhilosophy: "luxury",
      lifestyleTags: ["running_the_show"],
    });
    assert.ok(avoids.some((b) => ["Shein", "H&M", "Forever 21"].includes(b)));
  });
});
