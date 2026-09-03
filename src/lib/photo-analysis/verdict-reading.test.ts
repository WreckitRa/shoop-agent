import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReadingView,
  cardVoiceIssues,
  countEvidenceClauses,
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

  it("puts needs/test/risk strings in the check bucket, never under dont", () => {
    const view = buildReadingView({
      verdict: stubVerdict({
        size_and_fit: {
          sizing_confidence: 0.4,
          universal_size_warning: "Labels vary.",
          verified_measurements: [],
          known_good_garments: [],
          preferred_ease: [],
          starting_sizes: [],
          alteration_priorities: [],
          recurring_fit_risks: ["Cling through the mid"],
          product_size_selection_protocol: ["Start true to size on tops"],
          measurements_still_needed: ["Chest", "neck", "natural waist"],
        },
      }),
    });
    const fit = view.areas.find((a) => a.id === "fit");
    assert.ok(fit);
    const dontTitles = fit!.recs.filter((r) => r.kind === "dont").map((r) => r.title);
    const shown = [
      ...fit!.recs.filter((r) => r.kind === "check").map((r) => r.title),
      ...fit!.metrics.map((m) => m.value),
    ];
    for (const s of ["Chest", "neck", "natural waist", "Cling through the mid"]) {
      assert.equal(dontTitles.some((t) => t.includes(s)), false, s);
      assert.ok(shown.some((t) => t.includes(s)), s);
    }
    const proportion = view.areas.find((a) => a.id === "proportion");
    assert.ok(proportion?.recs.some((r) => r.kind === "check" && /low rise/i.test(r.title)));
    assert.equal(
      proportion?.recs.some((r) => r.kind === "dont" && /low rise/i.test(r.title)),
      false,
    );
  });

  it("dedupes a repeated string inside one area; insight drops when it matches the subtitle", () => {
    const view = buildReadingView({
      verdict: stubVerdict({
        proportion_and_silhouette: {
          strategy_summary: "Defined waist",
          preferred_overall_silhouette: ["Defined waist"],
          structure_level: "Soft structure",
          preferred_visual_lines: [],
          length_strategy: [],
          volume_distribution: [],
          proportion_priorities: ["Defined waist"],
          posture_or_mobility_considerations: [],
          test_in_fitting: [],
          based_on: [],
        },
      }),
    });
    const area = view.areas.find((a) => a.id === "proportion");
    assert.ok(area);
    const keys = [
      ...area!.metrics.map((m) => m.value),
      ...area!.recs.map((r) => r.title),
      area!.insight,
    ]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    assert.equal(keys.filter((k) => k === "defined waist").length, 1);
    assert.equal(area!.insight, "");
  });

  it("names every swatch and writes a palette line", () => {
    const view = buildReadingView({ verdict: stubVerdict() });
    assert.ok(view.palette.every((s) => s.name.trim().length > 0));
    assert.ok(view.avoid.every((s) => s.name.trim().length > 0 && s.use.trim().length > 0));
    assert.match(view.paletteLine, /near your face/i);
    assert.match(view.paletteLine, /skip/i);
  });

  it("badges FIX FIRST when there is a genuine avoid, CHECK when checks dominate", () => {
    const view = buildReadingView({ verdict: stubVerdict() });
    const colour = view.areas.find((a) => a.id === "colour");
    assert.equal(colour?.verdict, "n");
    assert.equal(colour?.vlab, "FIX FIRST");
    const fitOnlyCheck = buildReadingView({
      verdict: stubVerdict({
        size_and_fit: {
          sizing_confidence: 0.4,
          universal_size_warning: "",
          verified_measurements: [],
          known_good_garments: [],
          preferred_ease: [],
          starting_sizes: [],
          alteration_priorities: [],
          recurring_fit_risks: ["Sleeve length"],
          product_size_selection_protocol: [],
          measurements_still_needed: ["Chest"],
        },
      }),
    });
    const fit = fitOnlyCheck.areas.find((a) => a.id === "fit");
    assert.equal(fit?.verdict, "c");
    assert.equal(fit?.vlab, "CHECK");
  });

  it("holds exactly three rules: two dos and one dont", () => {
    const view = buildReadingView({ verdict: stubVerdict() });
    assert.equal(view.rules.length, 3);
    assert.equal(view.rules.filter((r) => r.ok).length, 2);
    assert.equal(view.rules.filter((r) => !r.ok).length, 1);
  });

  it("strips a trailing period from the headline", () => {
    const view = buildReadingView({
      verdict: stubVerdict({
        executive_verdict: {
          headline: "Warm and structured.",
          profile_summary: "You read warm and mid-depth.",
          signature_style_statement: "",
          desired_impression: [],
          strongest_assets: [],
          biggest_opportunities: [],
          non_negotiables: [],
          top_priorities: [],
        },
      }),
    });
    assert.equal(view.headline, "Warm and structured");
  });

  it("asserts opening caps and two evidence clauses on a voice fixture", () => {
    const opening =
      "You already have the tees. What's costing you is the black on top. Because you told me you live in worn knits and because you said no heels, we keep colour near the face — and your vetoes stay locked.";
    const view = buildReadingView({
      verdict: stubVerdict({
        user_facing_verdict: {
          title: "Your reading",
          opening,
          golden_rules: ["Tuck your tops in", "Warm colour near the face"],
          mistakes_to_avoid: ["Not black on top"],
          first_five_actions: [
            "One overshirt changes it",
            "Tuck and go high-waist",
            "Add a soft jacket",
          ],
          confidence_note: "",
          review_trigger: "",
        },
      }),
    });
    assert.ok(view.opening.split(/\s+/).length <= 55);
    assert.ok(countEvidenceClauses(view.opening) >= 2);
    assert.equal(
      cardVoiceIssues(view).filter((i) => i === "opening_evidence" || i.startsWith("opening_")).length,
      0,
    );
    assert.equal(view.steps[0]!.name, "One overshirt changes it");
  });

  it("does not clip opening, rules, or from lines", () => {
    const opening = Array.from({ length: 62 }, (_, i) => `word${i}`).join(" ");
    const longDo =
      "Tuck every top that can be tucked so the waist actually shows on you";
    const longDont =
      "Do not park black at the neck unless the knit is warm and mid-depth";
    const view = buildReadingView({
      verdict: stubVerdict({
        user_facing_verdict: {
          title: "Your reading",
          opening,
          golden_rules: [longDo, "Warm colour near the face"],
          mistakes_to_avoid: [longDont],
          first_five_actions: [
            "One overshirt changes it",
            "Tuck and go high-waist",
            "Add a soft jacket",
          ],
          confidence_note: "",
          review_trigger: "",
        },
        style_identity: {
          primary_direction: "Quiet and simple",
          secondary_direction: "One bold thing",
          style_descriptors: ["clean"],
          style_axes: [],
          signature_elements: ["soft jackets"],
          reference_patterns: [],
          aesthetic_boundaries: ["Not logo-heavy"],
          evolution_strategy: "Push one step toward polish.",
          based_on: [
            "identity: menswear, age 25, first-paycheck life-stage context",
          ],
        },
      }),
    });
    assert.equal(view.opening, opening);
    assert.equal(view.rules[0]?.text, longDo);
    assert.equal(view.rules[2]?.text, longDont);
    assert.equal(
      view.from[0],
      "identity: menswear, age 25, first-paycheck life-stage context",
    );
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

  it("copies style_identity.based_on onto from", () => {
    const view = buildReadingView({
      verdict: stubVerdict({
        style_identity: {
          primary_direction: "Quiet and simple",
          secondary_direction: "One bold thing",
          style_descriptors: ["clean"],
          style_axes: [],
          signature_elements: ["soft jackets"],
          reference_patterns: [],
          aesthetic_boundaries: ["Not logo-heavy"],
          evolution_strategy: "Push one step toward polish.",
          based_on: [
            "identity: menswear, age 25, first-paycheck life-stage context",
            "lifestyle: working mixed weeks",
          ],
        },
      }),
    });
    assert.equal(view.from.length, 2);
    assert.match(view.from[0] ?? "", /identity:/);
    assert.ok(!cardVoiceIssues(view).includes("internal_vocab"));
  });
});
