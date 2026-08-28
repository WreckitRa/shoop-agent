import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReadingView,
  readingMix,
  readingPalette,
  readingSteps,
} from "./verdict-reading";
import type { StylistVerdict } from "./verdict";

function stubVerdict(over: Partial<StylistVerdict> = {}): StylistVerdict {
  return {
    verdict_status: {
      readiness: "final",
      overall_confidence: 0.8,
      data_completeness: 0.7,
      sources_used: [],
      remaining_unknowns: [],
      assumptions: [],
      verdict_scope: "full",
    },
    executive_verdict: {
      headline: "Warm and structured",
      profile_summary: "You read warm and mid-depth.",
      signature_style_statement: "",
      desired_impression: [],
      impressions_to_avoid: [],
      strongest_assets: [],
      biggest_opportunities: [],
      non_negotiables: [],
      top_priorities: [],
    },
    style_identity: {
      primary_direction: "Quiet and simple",
      secondary_direction: "One bold thing",
      style_descriptors: ["clean", "easy"],
      style_axes: [],
      signature_elements: ["soft jackets"],
      reference_patterns: [],
      aesthetic_boundaries: ["Not logo-heavy"],
      evolution_strategy: "Push one step toward polish.",
      based_on: [],
    },
    color_system: {
      confidence: 0.8,
      seasonal_label: "Soft autumn",
      temperature: "Warm",
      depth: "Middle",
      chroma: "Muted",
      contrast_level: "Gentle",
      analysis_basis: "Warm cast with soft contrast.",
      best_neutrals: [
        {
          name: "Camel",
          representative_hex: "#B8894F",
          priority: "essential",
          best_uses: ["Knit near the face"],
          notes: "",
        },
      ],
      core_colors: [
        {
          name: "Olive",
          representative_hex: "#6B6B3E",
          priority: "strong",
          best_uses: ["Jacket"],
          notes: "",
        },
      ],
      accent_colors: [],
      near_face_colors: [
        {
          name: "Rust",
          representative_hex: "#8C5A3C",
          priority: "essential",
          best_uses: ["Crew neck"],
          notes: "",
        },
      ],
      whites: [],
      denim_washes: [],
      leather_colors: [],
      metals: [],
      use_carefully: [
        {
          color_or_family: "Black",
          issue: "Drains a gentle colouring",
          better_version: "Ink blue",
          how_to_wear: "Keep it below the waist",
          confidence: 0.9,
        },
      ],
      combinations: [],
      color_shopping_rules: ["Keep strong colour on top"],
      verification_needed: [],
    },
    proportion_and_silhouette: {
      strategy_summary: "Longer body, shorter legs — tuck and high rise.",
      preferred_overall_silhouette: ["Defined waist"],
      structure_level: "Soft structure",
      preferred_visual_lines: ["Vertical"],
      length_strategy: ["High waist"],
      volume_distribution: ["Balanced"],
      proportion_priorities: ["Mark the waist"],
      posture_or_mobility_considerations: [],
      test_in_fitting: ["Avoid low rise"],
      based_on: [],
    },
    size_and_fit: {
      sizing_confidence: 0.7,
      universal_size_warning:
        "No universal label can be assigned from height, weight, build, or a face photograph.",
      verified_measurements: [],
      known_good_garments: [
        {
          category: "tee",
          brand_or_item: "Uniqlo tee",
          labeled_size: "M",
          garment_measurements: [],
          fit_result: "true to size",
        },
      ],
      preferred_ease: [],
      starting_sizes: [
        {
          category: "Tops",
          sizing_system: "alpha",
          likely_starting_label: "M",
          confidence: 0.7,
          basis: "Height and the tee that already fits.",
          must_verify: [],
        },
        {
          category: "Trousers",
          sizing_system: "waist",
          likely_starting_label: "32",
          confidence: 0.6,
          basis: "Declared waist.",
          must_verify: [],
        },
      ],
      alteration_priorities: ["Hem"],
      recurring_fit_risks: ["Cling through the mid"],
      product_size_selection_protocol: ["Start true to size on tops"],
      measurements_still_needed: [],
    },
    garment_playbook: [],
    fabrics_patterns_and_climate: {
      climate_strategy: "Four-season mid-weight.",
      best_fabrics: ["Mid-weight knit"],
      useful_blends: ["Cotton-wool"],
      fabrics_to_use_carefully: ["Thin jersey"],
      texture_scale: [],
      best_patterns: [],
      pattern_scale_and_contrast: [],
      layering_strategy: ["Soft jacket over knit"],
      care_constraints: [],
    },
    grooming_and_accessories: {},
    outfit_formulas: [],
    wardrobe_plan: {},
    shopping_engine_profile: {},
    user_facing_verdict: {
      title: "Your reading",
      opening: "Five things I'd change from your photo.",
      golden_rules: ["Tuck your tops in", "Warm colour near the face"],
      mistakes_to_avoid: ["Not black on top", "Not mid-calf hems"],
      first_five_actions: [
        "Swap black tops for camel",
        "Tuck and go high-waist",
        "Add a soft jacket",
        "Drop mid-calf skirts",
        "Keep black below the waist",
      ],
      confidence_note: "",
      review_trigger: "",
    },
    ...over,
  } as StylistVerdict;
}

describe("verdict-reading", () => {
  it("builds areas, palette, avoid, steps from a stub verdict", () => {
    const view = buildReadingView({ verdict: stubVerdict() });
    assert.ok(view.areas.length >= 4);
    assert.equal(view.areas[0]?.id, "colour");
    assert.ok(view.palette.length >= 2);
    assert.equal(view.avoid[0]?.name, "BLACK");
    assert.equal(view.steps.length, 3);
    assert.equal(view.steps[0]?.label, "ONE CHANGE");
    const fit = view.areas.find((a) => a.id === "fit");
    assert.equal(fit?.verdict, "y");
    assert.match(fit?.sum ?? "", /true to size/i);
    assert.equal(fit?.metrics[0]?.value, "M");
  });

  it("readingPalette caps at six and two avoid", () => {
    const { palette, avoid } = readingPalette(stubVerdict());
    assert.ok(palette.length <= 6);
    assert.ok(avoid.length <= 2);
  });

  it("readingSteps falls back to outfit formulas", () => {
    const steps = readingSteps(
      stubVerdict({
        user_facing_verdict: {
          title: "t",
          opening: "o",
          golden_rules: [],
          mistakes_to_avoid: [],
          first_five_actions: [],
          confidence_note: "",
          review_trigger: "",
        },
        outfit_formulas: [
          {
            occasion: "Weekday",
            formality: "easy",
            formula: ["Knit", "Trouser"],
            color_options: ["camel"],
            silhouette_notes: "Tucked.",
            footwear: [],
            accessories: [],
            climate_variation: "",
            avoid: [],
          },
          {
            occasion: "Dinner",
            formality: "smart",
            formula: ["Blouse"],
            color_options: [],
            silhouette_notes: "Open neck.",
            footwear: [],
            accessories: [],
            climate_variation: "",
            avoid: [],
          },
          {
            occasion: "Weekend",
            formality: "casual",
            formula: ["Tee"],
            color_options: [],
            silhouette_notes: "Easy.",
            footwear: [],
            accessories: [],
            climate_variation: "",
            avoid: [],
          },
        ],
      }),
    );
    assert.equal(steps.length, 3);
    assert.equal(steps[0]?.name, "Weekday");
  });

  it("readingMix uses styleMix axes when present", () => {
    const mix = readingMix(
      {
        axes: [
          { label: "Minimal", percent: 58 },
          { label: "Parisian", percent: 27 },
          { label: "Bold", percent: 15 },
        ],
        headingToward: null,
        headingPercent: null,
      },
      { wornLabels: [], stealLabels: [], leanLabel: "" },
    );
    assert.equal(mix.length, 3);
    assert.equal(mix[0]?.percent, 58);
    assert.equal(mix[0]?.label, "Minimal");
  });

  it("readingMix falls back to worn / steal / lean", () => {
    const mix = readingMix(null, {
      wornLabels: ["Jeans"],
      stealLabels: ["Blazer"],
      leanLabel: "Minimal",
    });
    assert.ok(mix.length >= 2);
    assert.equal(
      mix.reduce((s, a) => s + a.percent, 0),
      100,
    );
  });
});
