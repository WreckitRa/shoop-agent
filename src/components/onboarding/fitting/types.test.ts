import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FITTING_Q_STEPS,
  FITTING_STEPS,
  STITCH_KNOTS,
  circleMirrorLabel,
  knotNowIndex,
  sewnThroughIndex,
} from "@/components/onboarding/fitting/types";
import { backfillFittingTellFromText } from "@/lib/onboarding/fitting-tell";

describe("fitting circle step model", () => {
  it("places circle between honesty and verdict", () => {
    assert.deepEqual(FITTING_Q_STEPS.slice(-2), ["honesty", "circle"]);
    assert.equal(FITTING_STEPS.at(-2), "circle");
    assert.equal(FITTING_STEPS.at(-1), "verdict");
    assert.ok(STITCH_KNOTS.some((k) => k.id === "circle"));
    assert.equal(STITCH_KNOTS.at(-1)?.id, "mint");
  });

  it("maps honesty/circle to the Circle knot and verdict to mint", () => {
    assert.equal(knotNowIndex("honesty"), 7);
    assert.equal(knotNowIndex("circle"), 7);
    assert.equal(knotNowIndex("verdict"), 8);
    assert.equal(sewnThroughIndex("honesty"), 6);
    assert.equal(sewnThroughIndex("circle"), 7);
    assert.equal(sewnThroughIndex("verdict"), 8);
  });

  it("formats mirror circle labels", () => {
    assert.equal(circleMirrorLabel(["Maya"]), "Maya");
    assert.equal(circleMirrorLabel(["Maya", "Jordan"]), "Maya, Jordan");
    assert.equal(circleMirrorLabel(["Maya", "Jordan", "Sam"]), "Maya, Jordan +1");
  });
});

describe("fitting-tell circle backfill", () => {
  it("extracts trusted circle names from ask language", () => {
    const out = backfillFittingTellFromText("I ask Maya and Jordan", {
      summary: "Noted",
    });
    assert.deepEqual(out.circleNames, ["Maya", "Jordan"]);
  });
});
