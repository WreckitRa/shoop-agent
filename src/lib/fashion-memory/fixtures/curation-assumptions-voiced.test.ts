import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURATION_PROMPT_SKELETON } from "../curation/prompt";
import { fallbackNextStepOffer } from "../curation/voice";
import { repairUnspokenAssumptions } from "../curation/narration-sanitize";
import type { DeliverCurationInput } from "../curation/types";

function assumptionsVoiced(opening: string, assumptions: string[]): boolean {
  return assumptions.every((line) => {
    const nouns = line
      .split(/\W+/)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length > 3)
      .slice(0, 2);
    const hay = opening.toLowerCase();
    return nouns.some((n) => hay.includes(n));
  });
}

describe("curation_assumptions_voiced", () => {
  it("house rule 12 requires voicing every assumption", () => {
    assert.match(CURATION_PROMPT_SKELETON, /THE APPOINTMENT/);
    assert.match(CURATION_PROMPT_SKELETON, /assumptions/);
  });

  it("key nouns from assumptions must appear in the opening", () => {
    const assumptions = [
      "Went with 4 options",
      "Stayed in your usual navy/white lane",
      "Assumed office",
    ];
    const opening =
      "I went with four options in your usual navy/white lane — assumed office.";
    assert.equal(assumptionsVoiced(opening, assumptions), true);
    assert.equal(assumptionsVoiced("Here are some shirts.", assumptions), false);
  });

  it("fallback voice always offers a next step", () => {
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [],
        },
      ],
      vetoes: [],
      narration: { opening: "Here are the shirts." },
    };
    const offer = fallbackNextStepOffer(output);
    assert.ok(offer.text.length > 8);
    assert.ok(offer.chips.length >= 2);
  });

  it("prepends an unspoken assumption onto the opening", () => {
    const opening = repairUnspokenAssumptions({
      opening: "Here are three shirts that earn the chair.",
      assumptions: ["Assumed office — say if it's for something else."],
    });
    assert.match(opening, /^Assumed office/i);
    assert.match(opening, /three shirts/);
  });

  it("leaves a reworded assumption untouched", () => {
    const original =
      "I assumed office — say if it's for something else. Here are three shirts.";
    const opening = repairUnspokenAssumptions({
      opening: original,
      assumptions: ["Assumed office — say if it's for something else."],
    });
    assert.equal(opening, original);
  });
});
