import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayHexForFamily } from "./family-hex";
import { FITTING_VERDICT_SCHEMA } from "./fitting-verdict-prompt";
import {
  coerceColorFamily,
  FITTING_LOOK_COUNT,
  parseFittingVerdict,
  slotForGarment,
  validateStyleContract,
} from "./style-contract";

describe("style contract", () => {
  it("asks Sol for exactly five looks", () => {
    const looks =
      FITTING_VERDICT_SCHEMA.properties.contract.properties.looks;
    assert.equal(looks.minItems, FITTING_LOOK_COUNT);
    assert.equal(looks.maxItems, FITTING_LOOK_COUNT);
  });

  it("does not ask the model for swatch hex", () => {
    const swatch =
      FITTING_VERDICT_SCHEMA.properties.contract.properties.palette.properties
        .near_face.items;
    assert.ok(!("hex" in swatch.properties));
  });

  it("maps cream and gray onto existing colour buckets", () => {
    assert.equal(coerceColorFamily("cream"), "white");
    assert.equal(coerceColorFamily("gray"), "grey");
    assert.equal(coerceColorFamily("multicolor"), "multi");
    assert.equal(slotForGarment("blouse"), "top");
    assert.equal(slotForGarment("shirt_dress"), "one_piece");
  });

  it("rejects a black top when black is avoid_near_face", () => {
    const parsed = parseFittingVerdict({
      reading: {
        headline: "Warm and clean",
        who_you_are: "Warm skin and dark hair.",
        the_shift: "Scale is costing you.",
        rules: [
          { rule: "Cream near the face.", why: "Warmth." },
          { rule: "Straight below.", why: "No taper." },
          { rule: "One structure.", why: "Edge." },
        ],
        this_week: "Work.",
        full_profile: "Regular top, straight bottom.",
      },
      contract: {
        palette: {
          near_face: [{ family: "white", shade: "cream", hex: "#F5F0E6" }],
          core: [{ family: "olive", shade: "olive", hex: "#556B2F" }],
          neutrals: [{ family: "brown", shade: "camel", hex: "#C19A6B" }],
          accents: [],
          avoid_near_face: [
            {
              family: "black",
              shade: "black",
              hex: "#111",
              why: "flattens",
              fix: "below",
            },
          ],
        },
        silhouette: {
          top_fit: "regular",
          bottom_fit: "straight",
          rise: "high",
          structure: "medium",
          length_notes: [],
        },
        necklines: { yes: ["v"], no: [] },
        fabrics: { yes: [], no: [] },
        patterns: { scale: "none", yes: [], no: [] },
        vetoes: ["crop"],
        looks: [
          {
            name: "Bad top",
            occasion_from: "week",
            pieces: [
              {
                slot: "top",
                garment_type: "tee",
                color_family: "black",
                shade: "black",
                fallback_family: "white",
                fit: "regular",
                neckline: "v",
                must_have: [],
                must_not: ["crop"],
              },
              {
                slot: "bottom",
                garment_type: "trousers",
                color_family: "olive",
                shade: "olive",
                fallback_family: null,
                fit: "straight",
                neckline: null,
                must_have: [],
                must_not: ["crop"],
              },
              {
                slot: "shoes",
                garment_type: "sneakers",
                color_family: "white",
                shade: "white",
                fallback_family: null,
                fit: null,
                neckline: null,
                must_have: [],
                must_not: ["crop"],
              },
            ],
          },
        ],
      },
    });
    assert.ok(parsed);
    const issues = validateStyleContract(parsed.contract, {
      hasPhoto: true,
      reading: parsed.reading,
    });
    assert.ok(issues.some((i) => i.includes("avoid_near_face")));
  });

  it("requires near_face and two avoids when there is a photo", () => {
    const parsed = parseFittingVerdict({
      reading: {
        headline: "Warm and clean",
        who_you_are: "Warm skin.",
        the_shift: "Scale.",
        rules: [
          { rule: "Cream near the face.", why: "Warmth." },
          { rule: "Straight below.", why: "No taper." },
          { rule: "One structure.", why: "Edge." },
        ],
        this_week: "Work.",
        full_profile: "Regular top.",
      },
      contract: {
        palette: {
          near_face: [],
          core: [{ family: "navy", shade: "ink navy", hex: "#131E30" }],
          neutrals: [{ family: "grey", shade: "charcoal", hex: "#585A5E" }],
          accents: [],
          avoid_near_face: [],
        },
        silhouette: {
          top_fit: "regular",
          bottom_fit: "straight",
          rise: "mid",
          structure: "medium",
          length_notes: [],
        },
        necklines: { yes: ["crew"], no: [] },
        fabrics: { yes: ["cotton"], no: [] },
        patterns: { scale: "none", yes: [], no: [] },
        vetoes: ["neon"],
        looks: [],
      },
    });
    const issues = validateStyleContract(parsed!.contract, { hasPhoto: true });
    assert.ok(issues.includes("near_face:empty"));
    assert.ok(issues.some((i) => i.startsWith("avoid_near_face:")));
  });

  it("fills family hex when the model omits or corrupts it, never camel", () => {
    const parsed = parseFittingVerdict({
      reading: {
        headline: "Warm and clean",
        who_you_are: "Warm skin.",
        the_shift: "Scale.",
        rules: [
          { rule: "Cream near the face.", why: "Warmth." },
          { rule: "Straight below.", why: "No taper." },
          { rule: "One structure.", why: "Edge." },
        ],
        this_week: "Work.",
        full_profile: "Regular top.",
      },
      contract: {
        palette: {
          near_face: [
            { family: "green", shade: "forest green", hex: "#254A3B},{" },
          ],
          core: [{ family: "olive", shade: "deep moss olive" }],
          neutrals: [{ family: "grey", shade: "charcoal", hex: "#44484B" }],
          accents: [],
          avoid_near_face: [],
        },
        silhouette: {
          top_fit: "regular",
          bottom_fit: "straight",
          rise: "mid",
          structure: "medium",
          length_notes: [],
        },
        necklines: { yes: ["crew"], no: [] },
        fabrics: { yes: ["cotton"], no: [] },
        patterns: { scale: "none", yes: [], no: [] },
        vetoes: ["neon"],
        looks: [],
      },
    });
    assert.equal(
      parsed?.contract.palette.near_face[0]?.hex,
      displayHexForFamily("green", "forest green"),
    );
    assert.equal(
      parsed?.contract.palette.core[0]?.hex,
      displayHexForFamily("olive", "deep moss olive"),
    );
    assert.equal(parsed?.contract.palette.neutrals[0]?.hex, "#44484B");
    const issues = validateStyleContract(parsed!.contract, { hasPhoto: false });
    assert.ok(!issues.some((i) => i.startsWith("hex:invalid")));
  });
});
