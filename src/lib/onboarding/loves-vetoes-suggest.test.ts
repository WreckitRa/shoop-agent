import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  suggestBrandAvoids,
  suggestBrandLikes,
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
