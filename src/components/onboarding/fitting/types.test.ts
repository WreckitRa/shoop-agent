import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FITTING_Q_STEPS,
  FITTING_STEPS,
  STITCH_KNOTS,
  TRACKER_GROUPS,
  circleMirrorLabel,
  fittingBackTarget,
  isMagicFittingStep,
  twinDocksInFlow,
  knotNowIndex,
  sewnThroughIndex,
  printSerialFromId,
  shortEraLabel,
  wornTrackerLabels,
} from "@/components/onboarding/fitting/types";
import { backfillFittingTellFromText } from "@/lib/onboarding/fitting-tell";

describe("fitting circle step model", () => {
  it("places consent, photo, then name before fit", () => {
    assert.deepEqual(FITTING_Q_STEPS.slice(0, 6), [
      "consent",
      "photo",
      "name",
      "fit",
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
    assert.equal(STITCH_KNOTS.at(-1)?.id, "circle");
    assert.equal(STITCH_KNOTS.at(-2)?.id, "mint");
    assert.equal(
      STITCH_KNOTS.find((k) => k.id === "photo")?.label,
      "Your photo",
    );
    assert.equal(
      STITCH_KNOTS.find((k) => k.id === "corner")?.label,
      "What you'd change",
    );
    assert.equal(
      STITCH_KNOTS.find((k) => k.id === "nolist")?.label,
      "Never again",
    );
    assert.equal(
      STITCH_KNOTS.find((k) => k.id === "mint")?.label,
      "Your reading",
    );
    assert.equal(
      STITCH_KNOTS.find((k) => k.id === "circle")?.label,
      "Your circle",
    );
    assert.equal(isMagicFittingStep("honesty"), false);
    assert.equal(isMagicFittingStep("nolist"), false);
    assert.equal(isMagicFittingStep("verdict"), true);
    assert.equal(isMagicFittingStep("circle"), true);
    assert.equal(twinDocksInFlow("photo", false), true);
    assert.equal(twinDocksInFlow("photo", true), false);
    assert.equal(twinDocksInFlow("consent", false), false);
    assert.equal(twinDocksInFlow("fit", false), false);
    const grouped = TRACKER_GROUPS.flatMap((g) => [...g.knotIds]);
    assert.deepEqual(
      grouped,
      STITCH_KNOTS.map((k) => k.id),
    );
  });

  it("maps honesty/verdict to mint and circle last, unsewn until asked", () => {
    assert.equal(knotNowIndex("consent"), 0);
    assert.equal(knotNowIndex("photo"), 0);
    assert.equal(knotNowIndex("name"), 1);
    assert.equal(knotNowIndex("fit"), 2);
    assert.equal(knotNowIndex("life"), 3);
    assert.equal(knotNowIndex("worn"), 5);
    assert.equal(knotNowIndex("corner"), 6);
    assert.equal(knotNowIndex("nolist"), 7);
    assert.equal(knotNowIndex("honesty"), 8);
    assert.equal(knotNowIndex("verdict"), 8);
    assert.equal(knotNowIndex("circle"), 9);
    assert.equal(sewnThroughIndex("consent"), -1);
    assert.equal(sewnThroughIndex("photo"), -1);
    assert.equal(sewnThroughIndex("name"), 0);
    assert.equal(sewnThroughIndex("fit"), 1);
    assert.equal(sewnThroughIndex("corner"), 5);
    assert.equal(sewnThroughIndex("verdict"), 7);
    assert.equal(sewnThroughIndex("circle"), 8);
  });

  it("lists each worn pick instead of collapsing to one mix axis", () => {
    assert.deepEqual(
      wornTrackerLabels(["Streetwear", "Athleisure", "Classic and polished"]),
      ["Streetwear", "Athleisure", "Classic and polished"],
    );
    assert.deepEqual(
      wornTrackerLabels(["Streetwear", " streetwear ", "Athleisure"]),
      ["Streetwear", "Athleisure"],
    );
    assert.deepEqual(wornTrackerLabels(["", "  "]), []);
  });

  it("formats mirror circle labels", () => {
    assert.equal(circleMirrorLabel(["Maya"]), "Maya");
    assert.equal(circleMirrorLabel(["Maya", "Jordan"]), "Maya, Jordan");
    assert.equal(circleMirrorLabel(["Maya", "Jordan", "Sam"]), "Maya, Jordan +1");
  });

  it("renders era labels, not ids", () => {
    assert.equal(shortEraLabel("23–29 · First-paycheck era"), "First paycheck");
    assert.equal(shortEraLabel("FIRST-PAYCHECK"), "First paycheck");
    assert.equal(shortEraLabel("23_29"), "First paycheck");
    assert.equal(shortEraLabel("30s · Prime era"), "Prime");
  });

  it("derives a stable 6-digit print serial from person id", () => {
    assert.equal(printSerialFromId("abc"), printSerialFromId("abc"));
    assert.equal(printSerialFromId("abc").length, 6);
    assert.notEqual(printSerialFromId("abc"), printSerialFromId("abd"));
  });

  it("walks back through quiz steps and the locked mint without skipping ahead", () => {
    assert.equal(fittingBackTarget({ step: "consent" }), null);
    assert.deepEqual(fittingBackTarget({ step: "photo" }), { step: "consent" });
    assert.deepEqual(fittingBackTarget({ step: "name" }), { step: "photo" });
    assert.deepEqual(fittingBackTarget({ step: "fit" }), { step: "name" });
    assert.deepEqual(fittingBackTarget({ step: "honesty" }), { step: "nolist" });
    assert.equal(
      fittingBackTarget({ step: "verdict", finale: "scan", hasPhoto: true }),
      null,
    );
    assert.deepEqual(
      fittingBackTarget({ step: "verdict", finale: "card", hasPhoto: true }),
      { step: "verdict", finale: "scan" },
    );
    assert.deepEqual(fittingBackTarget({ step: "circle" }), {
      step: "verdict",
      finale: "card",
    });
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
