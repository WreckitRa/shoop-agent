import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  BodyShapeBand,
  BustFullnessBand,
  MuscularityBand,
} from "@/lib/tryon/types";
import type { BuildKey, SilhouetteForm } from "./types";
import {
  buildArmPath,
  buildLegPath,
  buildTorsoPath,
  computeBodyGeometry,
  heightScale,
  pathCommandSignature,
  resolveVisualDefinition,
  silhouetteLabel,
  silhouetteMorphStyle,
  type BodySilhouetteInput,
  type LegLineVisual,
} from "./bodySilhouetteGeometry";

const FORMS: SilhouetteForm[] = ["m", "f", "n"];
const BUILDS: Array<BuildKey | null> = [
  null,
  "slim",
  "average",
  "athletic",
  "broad",
  "plus",
];
const SHAPES: Array<BodyShapeBand | null> = [
  null,
  "rectangle",
  "triangle",
  "inverted_triangle",
  "hourglass",
  "oval",
];
const DEFS: Array<MuscularityBand | null> = [null, "low", "moderate", "high"];
const BUSTS: Array<BustFullnessBand | null> = [
  null,
  "subtle",
  "average",
  "full",
  "very_full",
];
const LEGS: Array<LegLineVisual | null> = [null, "long_torso", "even", "long_leg"];

function base(over: Partial<BodySilhouetteInput> = {}): BodySilhouetteInput {
  return {
    form: "m",
    build: "average",
    muscularity: null,
    bodyShape: null,
    bustFullness: null,
    legLine: null,
    heightCm: 175,
    ...over,
  };
}

describe("body silhouette geometry", () => {
  it("athletic is wider at the shoulders and narrower at the waist than average", () => {
    const avg = computeBodyGeometry(base({ build: "average" }));
    const ath = computeBodyGeometry(base({ build: "athletic" }));
    assert.ok(ath.shoulder > avg.shoulder);
    assert.ok(ath.chest > avg.chest);
    assert.ok(ath.waist < avg.waist);
    assert.ok(ath.armWidth > avg.armWidth);
    assert.ok(ath.thighWidth > avg.thighWidth);
  });

  it("broad is a wider frame without plus's abdomen", () => {
    const avg = computeBodyGeometry(base({ build: "average" }));
    const broad = computeBodyGeometry(base({ build: "broad" }));
    const plus = computeBodyGeometry(base({ build: "plus" }));
    assert.ok(broad.shoulder > avg.shoulder);
    assert.ok(broad.hip > avg.hip);
    assert.ok(broad.belly < plus.belly);
    assert.ok(broad.waist < plus.waist);
  });

  it("triangle increases hips relative to shoulders", () => {
    const none = computeBodyGeometry(base());
    const tri = computeBodyGeometry(base({ bodyShape: "triangle" }));
    assert.ok(tri.hip / tri.shoulder > none.hip / none.shoulder);
  });

  it("inverted_triangle increases shoulders relative to hips", () => {
    const none = computeBodyGeometry(base());
    const inv = computeBodyGeometry(base({ bodyShape: "inverted_triangle" }));
    assert.ok(inv.shoulder / inv.hip > none.shoulder / none.hip);
  });

  it("hourglass reduces the waist", () => {
    const none = computeBodyGeometry(base());
    const hour = computeBodyGeometry(base({ bodyShape: "hourglass" }));
    assert.ok(hour.waist < none.waist);
  });

  it("oval increases the middle", () => {
    const none = computeBodyGeometry(base());
    const oval = computeBodyGeometry(base({ bodyShape: "oval" }));
    assert.ok(oval.belly > none.belly);
    assert.ok(oval.waist > none.waist);
  });

  it("bust only changes feminine chest geometry", () => {
    const femA = computeBodyGeometry(base({ form: "f", bustFullness: null }));
    const femF = computeBodyGeometry(base({ form: "f", bustFullness: "full" }));
    const masA = computeBodyGeometry(base({ form: "m", bustFullness: null }));
    const masF = computeBodyGeometry(base({ form: "m", bustFullness: "full" }));
    assert.ok(femF.chest > femA.chest);
    assert.equal(femF.shoulder, femA.shoulder);
    assert.equal(femF.waist, femA.waist);
    assert.equal(masF.chest, masA.chest);
    assert.equal(masF.shoulder, masA.shoulder);
  });

  it("long_torso and long_leg move the split in opposite directions", () => {
    const even = computeBodyGeometry(base({ legLine: "even" }));
    const torso = computeBodyGeometry(base({ legLine: "long_torso" }));
    const legs = computeBodyGeometry(base({ legLine: "long_leg" }));
    assert.ok(torso.torsoBottomY > even.torsoBottomY);
    assert.ok(legs.torsoBottomY < even.torsoBottomY);
  });

  it("missing definition uses the visual default without implying form state", () => {
    assert.equal(resolveVisualDefinition("athletic", null), "high");
    assert.equal(resolveVisualDefinition("slim", null), "low");
    assert.equal(resolveVisualDefinition("average", null), "moderate");
    assert.equal(resolveVisualDefinition("plus", "low"), "low");
    const unset = base({ muscularity: null, build: "athletic" });
    assert.equal(unset.muscularity, null);
    assert.equal(resolveVisualDefinition("athletic", null), "high");
  });

  it("onboarding submit still applies the same definition default", () => {
    assert.equal(resolveVisualDefinition("athletic", null), "high");
    assert.equal(resolveVisualDefinition("slim", null), "low");
    assert.equal(resolveVisualDefinition("average", null), "moderate");
    assert.equal(resolveVisualDefinition("broad", null), "moderate");
    assert.equal(resolveVisualDefinition("plus", null), "moderate");
    assert.equal(resolveVisualDefinition(null, null), "moderate");
  });

  it("every selection combination produces finite, clamped SVG coordinates", () => {
    const signatures = new Set<string>();
    for (const form of FORMS) {
      for (const build of BUILDS) {
        for (const bodyShape of SHAPES) {
          for (const muscularity of DEFS) {
            for (const bustFullness of BUSTS) {
              for (const legLine of LEGS) {
                const g = computeBodyGeometry({
                  form,
                  build,
                  bodyShape,
                  muscularity,
                  bustFullness,
                  legLine,
                  heightCm: 175,
                });
                for (const n of Object.values(g)) {
                  assert.equal(Number.isFinite(n), true);
                }
                const torso = buildTorsoPath(g);
                const arm = buildArmPath(1, g);
                const leg = buildLegPath(-1, g);
                signatures.add(pathCommandSignature(torso));
                for (const token of torso.split(/[\s,]+/)) {
                  if (token === "" || /[A-Za-z]/.test(token)) continue;
                  assert.equal(Number.isFinite(Number(token)), true);
                }
                assert.match(arm, /^M /);
                assert.match(leg, /^M /);
                assert.ok(heightScale(140) >= 0.95);
                assert.ok(heightScale(210) <= 1.05);
              }
            }
          }
        }
      }
    }
    assert.equal(signatures.size, 1);
  });

  it("reduced-motion disables morph interpolation", () => {
    assert.equal(silhouetteMorphStyle(true).transition, "none");
    assert.match(silhouetteMorphStyle(false).transition, /280ms/);
  });

  it("label uses explicit selections only", () => {
    assert.equal(
      silhouetteLabel(base({ form: "f", build: "athletic" })),
      "Feminine athletic silhouette",
    );
    assert.equal(
      silhouetteLabel(
        base({
          form: "f",
          build: "athletic",
          muscularity: "high",
          bodyShape: "hourglass",
          bustFullness: "full",
          legLine: "long_leg",
        }),
      ),
      "Feminine athletic silhouette, defined, hourglass shape, full bust, long legs",
    );
  });
});
