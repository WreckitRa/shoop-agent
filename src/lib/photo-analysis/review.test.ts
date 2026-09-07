import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStyleUserReview,
  listConfirmableTraits,
  parseStyleUserReview,
} from "./review";
import { verdictReadiness } from "./verdict-input";
import { STYLIST_READING_ROOT_KEYS, STYLIST_READING_SCHEMA, STYLIST_VERDICT_SCHEMA } from "./verdict-prompt";
import { hydrateStylistVerdict, parseStylistVerdict, STYLIST_VERDICT_ROOT_KEYS } from "./verdict";
import type { StylePhotoAnalysis } from "./result";

describe("style photo review", () => {
  it("builds confirm / correct / reject paths", () => {
    const rows = [
      {
        path: "visible_profile.face.primary_shape",
        section: "Face",
        label: "primary shape",
        value: "oval",
        confidence: 0.8,
        evidence: "oval outline",
      },
      {
        path: "visible_profile.color.eye_color",
        section: "Colour",
        label: "eye color",
        value: "dark brown",
        confidence: 0.7,
        evidence: "iris visible",
      },
    ];
    const review = buildStyleUserReview({
      rows,
      edits: { "visible_profile.color.eye_color": "medium warm brown" },
      rejected: ["visible_profile.face.primary_shape"],
      notes: "Regular ease, not slim.",
    });
    assert.deepEqual(review.confirmed_paths, []);
    assert.equal(review.corrections[0]?.corrected_value, "medium warm brown");
    assert.deepEqual(review.rejected_paths, [
      "visible_profile.face.primary_shape",
    ]);
    assert.equal(parseStyleUserReview(review)?.notes[0], "Regular ease, not slim.");
  });

  it("lists only the confirmable face traits", () => {
    const analysis = {
      visible_profile: {
        color: {
          visible_skin_surface_tone: {
            value: "medium olive",
            confidence: 0.7,
            evidence: "cheek",
            caveats: [],
          },
          skin_depth: {
            value: "medium",
            confidence: 0.8,
            evidence: "cheek",
            caveats: [],
          },
          eye_color: {
            value: "brown",
            confidence: 0.6,
            evidence: "iris visible",
            caveats: [],
          },
          hair_color: {
            value: "dark brown",
            confidence: 0.7,
            evidence: "roots",
            caveats: [],
          },
        },
        face: {
          primary_shape: {
            value: "oval",
            confidence: 0.5,
            evidence: "outline",
            caveats: [],
          },
        },
        hair_and_grooming: {},
        body_proportions: {},
        current_style_signals: {},
      },
    } as unknown as StylePhotoAnalysis;
    const rows = listConfirmableTraits(analysis);
    assert.deepEqual(
      rows.map((r) => r.label),
      ["Skin tone", "Eyes", "Hair", "Face"],
    );
    assert.equal(rows[0]?.path, "visible_profile.color.visible_skin_surface_tone");
  });

  it("attaches confirmed body to the review payload", () => {
    const review = buildStyleUserReview({
      rows: [
        {
          path: "visible_profile.color.eye_color",
          section: "You",
          label: "Eyes",
          value: "brown",
          confidence: 0.6,
          evidence: "iris",
        },
      ],
      edits: {},
      rejected: [],
      notes: "",
      confirmedBody: {
        height_cm: 179,
        weight_kg: 78,
        body_type: "athletic",
        muscularity: "moderate",
        body_shape: "rectangle",
        bust_fullness: null,
        leg_line: "even",
      },
    });
    assert.equal(review.confirmed_body?.height_cm, 179);
    assert.equal(review.confirmed_body?.muscularity, "moderate");
    assert.equal(parseStyleUserReview(review)?.confirmed_body?.weight_kg, 78);
  });
});

describe("stylist verdict readiness", () => {
  it("only requires how they dress — photo and scan-check can be skipped", () => {
    const missing = verdictReadiness({
      analysisUsable: false,
      reviewSubmitted: false,
      genderPresentation: "",
    });
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.field, "gender_presentation");
    assert.equal(
      verdictReadiness({
        analysisUsable: false,
        reviewSubmitted: false,
        genderPresentation: "menswear",
      }).length,
      0,
    );
  });

  it("does not require skippable height or lifestyle", () => {
    assert.equal(
      verdictReadiness({
        analysisUsable: true,
        reviewSubmitted: true,
        genderPresentation: "womenswear",
      }).length,
      0,
    );
  });

  it("keeps the verdict schema strict", () => {
    assert.equal(STYLIST_VERDICT_SCHEMA.additionalProperties, false);
    assert.deepEqual(
      [...STYLIST_VERDICT_SCHEMA.required],
      [...STYLIST_VERDICT_ROOT_KEYS],
    );
    assert.equal(parseStylistVerdict({}), null);
  });

  it("parses a reading-card payload after hydrating unused roots", () => {
    assert.deepEqual(
      [...STYLIST_READING_SCHEMA.required],
      [...STYLIST_READING_ROOT_KEYS],
    );
    const reading = {
      verdict_status: {
        readiness: "final",
        overall_confidence: 0.8,
        data_completeness: 0.8,
        sources_used: ["questionnaire"],
        remaining_unknowns: [],
        assumptions: [],
        verdict_scope: "fitting card",
      },
      executive_verdict: {
        headline: "Clean lines",
        profile_summary: "You wear structure well.",
        signature_style_statement: "Tailored ease",
        desired_impression: ["sharp"],
        impressions_to_avoid: ["sloppy"],
        strongest_assets: ["shoulders"],
        biggest_opportunities: ["rise"],
        non_negotiables: ["ease"],
        top_priorities: ["jacket"],
      },
      user_facing_verdict: {
        title: "Clean lines",
        opening: "Keep the shoulder honest.",
        golden_rules: ["Structure over cling"],
        mistakes_to_avoid: ["Boxy everything"],
        first_five_actions: ["One jacket that fits"],
        confidence_note: "High",
        review_trigger: "If your week changes",
      },
    };
    const parsed = parseStylistVerdict(reading);
    assert.ok(parsed);
    assert.equal(parsed.executive_verdict.headline, "Clean lines");
    const hydrated = hydrateStylistVerdict(reading) as Record<string, unknown>;
    assert.ok("shopping_engine_profile" in hydrated);
    assert.ok("wardrobe_plan" in hydrated);
  });

  it("parses a fitting { reading, contract } payload", () => {
    const parsed = parseStylistVerdict({
      reading: {
        headline: "Warm, clean, and grown-up",
        who_you_are: "Warm skin, dark hair, brown eyes.",
        the_shift: "What's costing you is scale.",
        rules: [
          { rule: "Cream near the face.", why: "Warmth does the work." },
          { rule: "Straight below.", why: "Taper reads campus." },
          { rule: "One structured piece.", why: "Ease needs an edge." },
        ],
        this_week: "Office, study, drinks.",
        full_profile: "Regular top, straight bottom, high rise.",
      },
      contract: {
        palette: {
          near_face: [
            { family: "white", shade: "cream", hex: "#F5F0E6" },
            { family: "olive", shade: "olive", hex: "#556B2F" },
            { family: "orange", shade: "rust", hex: "#B7410E" },
          ],
          core: [{ family: "brown", shade: "camel", hex: "#C19A6B" }],
          neutrals: [{ family: "brown", shade: "dark brown", hex: "#3B2F2F" }],
          accents: [{ family: "green", shade: "emerald", hex: "#046307" }],
          avoid_near_face: [
            {
              family: "black",
              shade: "black",
              hex: "#111111",
              why: "flattens",
              fix: "below the waist",
            },
            {
              family: "blue",
              shade: "icy blue",
              hex: "#A7C7E7",
              why: "washes out",
              fix: "warm white",
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
        necklines: { yes: ["collar", "v"], no: ["mock"] },
        fabrics: { yes: ["linen"], no: [] },
        patterns: { scale: "none", yes: [], no: [] },
        vetoes: ["crop", "heels"],
        looks: [
          {
            name: "Office days",
            occasion_from: "working_mixed",
            pieces: [
              {
                slot: "top",
                garment_type: "shirt",
                color_family: "white",
                shade: "cream",
                fallback_family: "beige",
                fit: "relaxed",
                neckline: "collar",
                must_have: ["poplin"],
                must_not: ["crop", "heels", "logo"],
              },
              {
                slot: "bottom",
                garment_type: "trousers",
                color_family: "white",
                shade: "ecru",
                fallback_family: null,
                fit: "straight",
                neckline: null,
                must_have: [],
                must_not: ["crop", "heels"],
              },
              {
                slot: "shoes",
                garment_type: "loafers",
                color_family: "brown",
                shade: "tan",
                fallback_family: null,
                fit: null,
                neckline: null,
                must_have: [],
                must_not: ["crop", "heels"],
              },
            ],
          },
        ],
      },
    });
    assert.ok(parsed?.reading);
    assert.equal(parsed?.reading?.headline, "Warm, clean, and grown-up");
    assert.equal(parsed?.user_facing_verdict.title, "Warm, clean, and grown-up");
    assert.equal(parsed?.contract?.looks[0]?.pieces[0]?.color_family, "white");
  });
});
