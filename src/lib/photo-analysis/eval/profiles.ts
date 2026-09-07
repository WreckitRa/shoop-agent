import type { StylistVerdict } from "../verdict";
import { buildReadingView, type ReadingView } from "../verdict-reading";

/** In-memory card-text fixtures only. Jaccard / similarity runs on Prisma-seeded generated verdicts (`eval/prisma-seed.ts` + `--generate`). */
export type VerdictEvalProfile = {
  id: string;
  gender: "male" | "female";
  taste: "minimal" | "bold";
  photo: boolean;
  verdict: StylistVerdict;
};

function base(over: Partial<StylistVerdict> = {}): StylistVerdict {
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
      primary_direction: "clean and layered",
      secondary_direction: "one bold thing",
      style_descriptors: ["clean"],
      style_axes: [],
      signature_elements: ["soft jackets"],
      reference_patterns: [],
      aesthetic_boundaries: ["Logo-heavy prints"],
      evolution_strategy: "One step toward polish.",
      based_on: [],
    },
    color_system: {
      confidence: 0.8,
      seasonal_label: null,
      temperature: "Warm",
      depth: "Middle",
      chroma: "Muted",
      contrast_level: "Gentle",
      analysis_basis: "Warm cast with soft contrast.",
      best_neutrals: [
        {
          name: "Camel",
          representative_hex: "#C4A574",
          priority: "essential",
          best_uses: ["Knit near the face"],
          notes: "",
        },
      ],
      core_colors: [],
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
          color_or_family: "Optical white",
          issue: "Flattens the face",
          better_version: "Ivory",
          how_to_wear: "Keep it below the waist",
          confidence: 0.9,
        },
      ],
      combinations: [],
      color_shopping_rules: ["Keep strong colour on top"],
      verification_needed: [],
    },
    proportion_and_silhouette: {
      strategy_summary: "Let the shoulder lead.",
      preferred_overall_silhouette: ["Soft structure"],
      structure_level: "Soft structure",
      preferred_visual_lines: ["Vertical"],
      length_strategy: ["High waist"],
      volume_distribution: ["Balanced"],
      proportion_priorities: ["Mark the waist"],
      posture_or_mobility_considerations: [],
      test_in_fitting: ["Rise on trousers"],
      based_on: [],
    },
    size_and_fit: {
      sizing_confidence: 0.7,
      universal_size_warning: "Labels vary by brand.",
      verified_measurements: [],
      known_good_garments: [],
      preferred_ease: [],
      starting_sizes: [
        {
          category: "Tops",
          sizing_system: "alpha",
          likely_starting_label: "M",
          confidence: 0.7,
          basis: "Height and a tee that already fits.",
          must_verify: [],
        },
      ],
      alteration_priorities: ["Hem"],
      recurring_fit_risks: ["Cling through the mid"],
      product_size_selection_protocol: ["Start true to size on tops"],
      measurements_still_needed: ["Chest"],
    },
    garment_playbook: [],
    fabrics_patterns_and_climate: {
      climate_strategy: "Four-season mid-weight.",
      best_fabrics: ["Mid-weight knit"],
      useful_blends: [],
      fabrics_to_use_carefully: ["Thin jersey"],
      texture_scale: [],
      best_patterns: [],
      pattern_scale_and_contrast: [],
      layering_strategy: ["Soft jacket over knit"],
      care_constraints: [],
    },
    grooming_and_accessories: {},
    outfit_formulas: [
      {
        occasion: "Video-call days",
        formality: "easy",
        formula: ["olive overshirt", "white tee", "regular-taper chino"],
        color_options: ["olive"],
        silhouette_notes: "",
        footwear: ["sneakers"],
        accessories: [],
        climate_variation: "",
        avoid: [],
      },
    ],
    wardrobe_plan: {},
    shopping_engine_profile: {},
    user_facing_verdict: {
      title: "Your reading",
      opening:
        "You already have the tees. What's costing you is black on top. Because you told me you live in worn knits and because you said no heels, we keep colour near the face — and your vetoes stay locked.",
      golden_rules: ["Warm colour near the face", "Tuck your tops in"],
      mistakes_to_avoid: ["Not black on top"],
      first_five_actions: [
        "One overshirt changes it",
        "Tuck and go high-waist",
        "Add a soft jacket",
      ],
      confidence_note: "",
      review_trigger: "",
    },
    ...over,
  } as StylistVerdict;
}

const NO_PHOTO_COLOR = {
  confidence: 0,
  seasonal_label: null,
  temperature: null,
  depth: null,
  chroma: null,
  contrast_level: null,
  analysis_basis: "",
  best_neutrals: [],
  core_colors: [],
  accent_colors: [],
  near_face_colors: [],
  whites: [],
  denim_washes: [],
  leather_colors: [],
  metals: [],
  use_carefully: [],
  combinations: [],
  color_shopping_rules: [],
  verification_needed: [],
};

export const VERDICT_EVAL_PROFILES: VerdictEvalProfile[] = [
  {
    id: "male-minimal-photo",
    gender: "male",
    taste: "minimal",
    photo: true,
    verdict: base(),
  },
  {
    id: "male-bold-photo",
    gender: "male",
    taste: "bold",
    photo: true,
    verdict: base({
      user_facing_verdict: {
        title: "Your reading",
        opening:
          "You already wear the loud print. What's costing you is the cling. Because you told me you want bolder nights and because you said no skinny jeans, we add structure — and your vetoes stay locked.",
        golden_rules: ["One loud piece", "Keep the rest quiet"],
        mistakes_to_avoid: ["Not two prints at once"],
        first_five_actions: [
          "One overshirt changes it",
          "Swap the skinny jean",
          "Add a dark polo",
        ],
        confidence_note: "",
        review_trigger: "",
      },
    }),
  },
  {
    id: "female-minimal-photo",
    gender: "female",
    taste: "minimal",
    photo: true,
    verdict: base({
      user_facing_verdict: {
        title: "Your reading",
        opening:
          "You already have the black knit. What's costing you is the optical white. Because you told me you want quiet luxury and because you said no heels, we keep rust at the face — and your vetoes stay locked.",
        golden_rules: ["Rust near the face", "Define the waist"],
        mistakes_to_avoid: ["Not optical white up top"],
        first_five_actions: [
          "One overshirt changes it",
          "Tuck and go high-waist",
          "Swap the white shirt",
        ],
        confidence_note: "",
        review_trigger: "",
      },
    }),
  },
  {
    id: "female-bold-photo",
    gender: "female",
    taste: "bold",
    photo: true,
    verdict: base({
      user_facing_verdict: {
        title: "Your reading",
        opening:
          "You already steal the sequin. What's costing you is the mid-calf hem. Because you told me you want nights out and because you said no cling, we shorten the line — and your vetoes stay locked.",
        golden_rules: ["Hem at the knee", "One shine piece"],
        mistakes_to_avoid: ["Not mid-calf hems"],
        first_five_actions: [
          "Shorten the hem line",
          "One sequin, then stop",
          "Add a soft jacket",
        ],
        confidence_note: "",
        review_trigger: "",
      },
    }),
  },
  {
    id: "male-minimal-nophoto",
    gender: "male",
    taste: "minimal",
    photo: false,
    verdict: base({
      color_system: NO_PHOTO_COLOR,
      user_facing_verdict: {
        title: "Your reading",
        opening:
          "You already have the grey tee. What's costing you is the boxy layer. Because you told me you buy for value and because you said no logos, we keep the cut clean — and your vetoes stay locked.",
        golden_rules: ["Clean shoulder line", "Mid-weight knit"],
        mistakes_to_avoid: ["Not logo tees"],
        first_five_actions: [
          "One overshirt changes it",
          "Drop the boxy layer",
          "Keep the grey tee",
        ],
        confidence_note: "",
        review_trigger: "",
      },
    }),
  },
  {
    id: "female-bold-nophoto",
    gender: "female",
    taste: "bold",
    photo: false,
    verdict: base({
      color_system: NO_PHOTO_COLOR,
      user_facing_verdict: {
        title: "Your reading",
        opening:
          "You already chase the print. What's costing you is the missing waist. Because you told me you want to become sharper and because you said no tight dresses, we mark the waist — and your vetoes stay locked.",
        golden_rules: ["Mark the waist", "One print at a time"],
        mistakes_to_avoid: ["Not tight dresses"],
        first_five_actions: [
          "Belt the dress once",
          "One print at a time",
          "Add a structured jacket",
        ],
        confidence_note: "",
        review_trigger: "",
      },
    }),
  },
];

export function cardTextFromProfile(profile: VerdictEvalProfile): {
  view: ReadingView;
  text: string;
} {
  const view = buildReadingView({ verdict: profile.verdict });
  const text = [
    view.headline,
    view.opening,
    view.paletteLine,
    ...view.rules.map((r) => r.text),
    ...view.areas.flatMap((a) => [
      a.name,
      a.sum,
      a.insight,
      a.vlab,
      ...a.recs.map((r) => `${r.kind}:${r.title}`),
    ]),
    ...view.steps.map((s) => s.name),
  ]
    .filter(Boolean)
    .join("\n");
  return { view, text };
}
