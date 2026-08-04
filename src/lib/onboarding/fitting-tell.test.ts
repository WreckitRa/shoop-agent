import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPatchFromFittingTell,
  deferredFeedback,
  filledLabels,
  backfillFittingTellFromText,
  resolveHeightCm,
  type FittingTellExtraction,
} from "./fitting-tell";

describe("fitting-tell", () => {
  it("converts imperial height", () => {
    assert.equal(
      resolveHeightCm({
        heightFt: 5,
        heightIn: 11,
        summary: "x",
      }),
      Math.round((5 * 12 + 11) * 2.54),
    );
  });

  it("builds merged patch for identity + spend + no-list", () => {
    const extraction: FittingTellExtraction = {
      preferredName: "Alex",
      genderPresentation: "masculine",
      ageYears: 32,
      budgetPhilosophies: ["luxury"],
      brandLikes: ["Everlane"],
      hardAvoids: ["logos"],
      build: "athletic",
      heightFt: 5,
      heightIn: 11,
      summary: "Saved name and height.",
    };
    const patch = buildPatchFromFittingTell(extraction, {
      budgetPhilosophies: ["best_value"],
      brandLikes: ["COS"],
    });
    assert.equal(patch.profile?.preferredName, "Alex");
    assert.equal(patch.profile?.genderPresentation, "masculine");
    assert.ok(patch.profile?.styleEra?.includes("30s"));
    assert.equal(patch.profile?.valuePhilosophy, "best_value,luxury");
    assert.equal(patch.sizing?.bodyType, "athletic");
    assert.equal(patch.sizing?.heightCm, Math.round((5 * 12 + 11) * 2.54));
    assert.ok(patch.brands?.some((b) => b.brand === "Everlane"));
    assert.ok(patch.hardNegatives?.some((h) => h.value === "logos"));
    assert.deepEqual(filledLabels(extraction).sort(), [
      "brands loved",
      "build",
      "era",
      "gender",
      "height",
      "name",
      "no-list",
      "spend",
    ].sort());
  });

  it("flags brands as deferred on the name step", () => {
    const extraction: FittingTellExtraction = {
      preferredName: "Alex",
      brandLikes: ["Everlane", "COS"],
      hardAvoids: ["logos"],
      summary: "Noted brands for later.",
    };
    const note = deferredFeedback(extraction, "name");
    assert.match(note, /brands & no-list/i);
    // On the nolist step, brands are current — not deferred.
    assert.equal(deferredFeedback(extraction, "nolist"), "");
  });

  it("backfills name, era, weight, and hard avoids from surface text", () => {
    const filled = backfillFittingTellFromText(
      "Call me Raphael. Early thirties, masculine. I weigh 82 kg. Hard nos: neon and distressed denim.",
      { summary: "x" },
    );
    assert.equal(filled.preferredName, "Raphael");
    assert.deepEqual(filled.styleEras, ["30s"]);
    assert.equal(filled.genderPresentation, "masculine");
    assert.equal(filled.weightKg, 82);
    assert.ok(filled.hardAvoids?.some((h) => /neon/i.test(h)));
  });
});
