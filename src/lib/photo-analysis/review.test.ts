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
  it("blocks until analysis, review, and identity exist", () => {
    const missing = verdictReadiness({
      analysisUsable: false,
      reviewSubmitted: false,
      genderPresentation: "",
    });
    assert.equal(missing.length, 3);
    assert.equal(
      verdictReadiness({
        analysisUsable: true,
        reviewSubmitted: true,
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
});
