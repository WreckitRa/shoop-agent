import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  familyIdsMentionedInText,
  garmentFamilyId,
} from "../catalog-search/garment-taxonomy";
import { isStylePhraseGarment } from "../router/sanitize-garments";
import { normalizeGarmentClarificationAnswer } from "../intake/garment-answer";

function unnamed(
  garments: string[],
  userTurns: string[],
): string[] {
  const named = new Set<string>();
  for (const turn of userTurns) {
    for (const id of familyIdsMentionedInText(turn)) named.add(id);
    for (const g of normalizeGarmentClarificationAnswer(turn)) {
      named.add(garmentFamilyId(g));
    }
  }
  return garments.filter((g) => !named.has(garmentFamilyId(g)));
}

describe("unnamed garment gate — provenance not vocabulary", () => {
  it("hoodies / chinos / a puffer / sundresses / sweats never re-ask", () => {
    const cases: Array<{ utter: string; brief: string[] }> = [
      { utter: "hoodies", brief: ["hoodie"] },
      { utter: "chinos", brief: ["chinos"] },
      { utter: "a puffer", brief: ["puffer"] },
      { utter: "sundresses", brief: ["sundress"] },
      { utter: "sweats", brief: ["sweats"] },
    ];
    for (const { utter, brief } of cases) {
      assert.deepEqual(
        unnamed(brief, [utter]),
        [],
        `${utter} should name ${brief.join(",")}`,
      );
    }
  });

  it("router-invented shirt with no source in the turn is unnamed", () => {
    assert.deepEqual(unnamed(["shirt"], ["something cool for the weekend"]), [
      "shirt",
    ]);
  });

  it("style phrases are not families", () => {
    assert.equal(isStylePhraseGarment("cool style laid back"), true);
    assert.equal(isStylePhraseGarment("hoodies"), false);
    assert.equal(isStylePhraseGarment("a puffer"), false);
  });
});
