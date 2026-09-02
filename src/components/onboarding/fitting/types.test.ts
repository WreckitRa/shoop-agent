import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FITTING_Q_STEPS,
  FITTING_STEPS,
  STITCH_KNOTS,
  TRACKER_GROUPS,
  circleMirrorLabel,
  knotNowIndex,
  sewnThroughIndex,
  printSerialFromId,
} from "@/components/onboarding/fitting/types";
import { backfillFittingTellFromText } from "@/lib/onboarding/fitting-tell";

describe("fitting circle step model", () => {
  it("places consent, photo, then fit before name", () => {
    assert.deepEqual(FITTING_Q_STEPS.slice(0, 6), [
      "consent",
      "photo",
      "fit",
      "name",
      "life",
      "spend",
    ]);
    assert.deepEqual(FITTING_Q_STEPS.slice(-3), ["nolist", "honesty", "circle"]);
    assert.equal(FITTING_STEPS.at(-2), "verdict");
    assert.equal(FITTING_STEPS.at(-1), "circle");
    assert.ok(FITTING_STEPS.includes("corner"));
    assert.ok(!FITTING_STEPS.includes("wanted" as (typeof FITTING_STEPS)[number]));
    assert.ok(STITCH_KNOTS.some((k) => k.id === "life"));
    assert.ok(STITCH_KNOTS.some((k) => k.id === "fit"));
    assert.ok(STITCH_KNOTS.some((k) => k.id === "circle"));
    assert.equal(STITCH_KNOTS.at(-1)?.id, "mint");
    const grouped = TRACKER_GROUPS.flatMap((g) => [...g.knotIds]);
    assert.deepEqual(
      grouped,
      STITCH_KNOTS.map((k) => k.id),
    );
  });

  it("maps honesty/circle to the Circle knot and verdict to mint", () => {
    assert.equal(knotNowIndex("consent"), 0);
    assert.equal(knotNowIndex("photo"), 0);
    assert.equal(knotNowIndex("fit"), 1);
    assert.equal(knotNowIndex("name"), 2);
    assert.equal(knotNowIndex("life"), 3);
    assert.equal(knotNowIndex("worn"), 5);
    assert.equal(knotNowIndex("corner"), 6);
    assert.equal(knotNowIndex("nolist"), 7);
    assert.equal(knotNowIndex("honesty"), 8);
    assert.equal(knotNowIndex("circle"), 8);
    assert.equal(knotNowIndex("verdict"), 9);
    assert.equal(sewnThroughIndex("consent"), -1);
    assert.equal(sewnThroughIndex("photo"), -1);
    assert.equal(sewnThroughIndex("fit"), 0);
    assert.equal(sewnThroughIndex("name"), 1);
    assert.equal(sewnThroughIndex("corner"), 5);
    assert.equal(sewnThroughIndex("verdict"), 8);
    assert.equal(sewnThroughIndex("circle"), 8);
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
