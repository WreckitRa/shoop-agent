import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FITTING_Q_STEPS,
  FITTING_STEPS,
  STITCH_KNOTS,
  circleMirrorLabel,
  knotNowIndex,
  sewnThroughIndex,
  printSerialFromId,
} from "@/components/onboarding/fitting/types";
import { backfillFittingTellFromText } from "@/lib/onboarding/fitting-tell";

describe("fitting circle step model", () => {
  it("places photo first, then name/life/spend, fit after spend", () => {
    assert.deepEqual(FITTING_Q_STEPS.slice(0, 5), [
      "photo",
      "name",
      "life",
      "spend",
      "fit",
    ]);
    assert.deepEqual(FITTING_Q_STEPS.slice(-2), ["honesty", "circle"]);
    assert.equal(FITTING_STEPS.at(-2), "circle");
    assert.equal(FITTING_STEPS.at(-1), "verdict");
    assert.ok(STITCH_KNOTS.some((k) => k.id === "life"));
    assert.ok(STITCH_KNOTS.some((k) => k.id === "fit"));
    assert.ok(STITCH_KNOTS.some((k) => k.id === "circle"));
    assert.equal(STITCH_KNOTS.at(-1)?.id, "mint");
  });

  it("maps honesty/circle to the Circle knot and verdict to mint", () => {
    assert.equal(knotNowIndex("photo"), 0);
    assert.equal(knotNowIndex("life"), 2);
    assert.equal(knotNowIndex("fit"), 4);
    assert.equal(knotNowIndex("honesty"), 8);
    assert.equal(knotNowIndex("circle"), 8);
    assert.equal(knotNowIndex("verdict"), 9);
    assert.equal(sewnThroughIndex("photo"), -1);
    assert.equal(sewnThroughIndex("name"), 0);
    assert.equal(sewnThroughIndex("life"), 1);
    assert.equal(sewnThroughIndex("spend"), 2);
    assert.equal(sewnThroughIndex("honesty"), 7);
    assert.equal(sewnThroughIndex("circle"), 8);
    assert.equal(sewnThroughIndex("verdict"), 9);
  });

  it("formats mirror circle labels", () => {
    assert.equal(circleMirrorLabel(["Maya"]), "Maya");
    assert.equal(circleMirrorLabel(["Maya", "Jordan"]), "Maya, Jordan");
    assert.equal(circleMirrorLabel(["Maya", "Jordan", "Sam"]), "Maya, Jordan +1");
  });

  it("derives a stable 6-digit print serial from person id", () => {
    assert.equal(printSerialFromId("abc"), printSerialFromId("abc"));
    assert.equal(printSerialFromId("abc").length, 6);
    assert.notEqual(printSerialFromId("abc"), printSerialFromId("abd"));
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
