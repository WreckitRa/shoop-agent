import type { FashionSearchBrief } from "../router/types";
import type { PlanSearchInput } from "../search-planner/tool-schema";
import type { FashionFactRow, PersonRow, StyleSignalRow } from "../types";

export const coldProfileNoColorShirtBrief: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "I need a shirt",
  department_scope: "mens",
  color_direction: { source: "none" },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [],
  },
};

export const cyprusWeddingColdPaletteBrief: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "wedding_guest",
  quantity_hint: "one outfit",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Smart wedding guest look for Cyprus heat next month.",
  department_scope: "mens",
  color_direction: { source: "none" },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt", "trousers", "shoes"],
    sizes_unconfirmed: [],
  },
};

export const statedBlackShirtBrief: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: ["black"],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Black shirt.",
  department_scope: "mens",
  color_direction: { source: "stated", stated_colors: ["black"] },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [],
  },
};

export const profileMonochromeWorkBrief: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "work",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Monochrome office shirts.",
  department_scope: "mens",
  color_direction: { source: "profile" },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [],
  },
};

export const monochromeWorkSignals: StyleSignalRow[] = [
  {
    id: "sig1",
    user_id: "u1",
    person_id: "p1",
    context: "work",
    signal_type: "style",
    polarity: 1,
    value: "monochrome",
    source: "stated",
    confidence: 0.9,
    evidence_count: 1,
    status: "active",
    source_quote: null,
    first_seen_at: "2026-07-08T10:00:00Z",
    last_seen_at: "2026-07-08T10:00:00Z",
  },
];

export const emptyPostIntakePerson: PersonRow = {
  id: "p1",
  user_id: "u1",
  relation: "self",
  name: null,
  birthday: null,
  notes: null,
  intake_completed_at: "2026-07-08T10:00:00Z",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

export const warmSizeFacts: FashionFactRow[] = [
  {
    id: "f1",
    user_id: "u1",
    person_id: "p1",
    fact_type: "gender_presentation",
    garment_type: null,
    value: { presentation: "mens" },
    source_quote: null,
    status: "active",
    superseded_by: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: "f2",
    user_id: "u1",
    person_id: "p1",
    fact_type: "size",
    garment_type: "tops",
    value: { system: "alpha", value: "M" },
    source_quote: null,
    status: "active",
    superseded_by: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: "f3",
    user_id: "u1",
    person_id: "p1",
    fact_type: "size",
    garment_type: "bottoms",
    value: { system: "alpha", value: "M" },
    source_quote: null,
    status: "active",
    superseded_by: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: "f4",
    user_id: "u1",
    person_id: "p1",
    fact_type: "size",
    garment_type: "shoes",
    value: { system: "us", value: "10" },
    source_quote: null,
    status: "active",
    superseded_by: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

export function plannerOutputForBrief(
  brief: FashionSearchBrief,
  overrides?: Partial<PlanSearchInput>,
): PlanSearchInput {
  const garment = brief.garments[0] ?? "item";
  return {
    mode: brief.request_type,
    reasoning: "fixture planner output",
    slots: [
      {
        slot_id: garment,
        garment,
        role: "anchor",
        style_direction: brief.style_direction,
        palette_constraint:
          brief.color_direction?.source === "stated"
            ? "black and companions"
            : brief.color_direction?.source === "profile"
              ? "monochrome neutrals"
              : brief.occasion_context.includes("wedding")
                ? "light neutrals, sand, white, soft blue"
                : null,
        palette_source:
          brief.color_direction?.source === "stated"
            ? "stated"
            : brief.color_direction?.source === "profile"
              ? "profile"
              : brief.occasion_context.includes("wedding")
                ? "occasion_default"
                : "spread",
        options_wanted: 4,
        query_variants:
          brief.color_direction?.source === "stated"
            ? [
                "black linen shirt",
                "slim cotton shirt",
                "minimal formal shirt",
                "premium poplin shirt",
              ]
            : brief.occasion_context.includes("wedding")
              ? [
                  "linen wedding shirt",
                  "beige summer shirt",
                  "lightweight formal shirt",
                  "classic cotton shirt",
                ]
              : [
                  "slim oxford shirt",
                  "classic cotton shirt",
                  "minimal formal shirt",
                  "premium poplin shirt",
                ],
      },
    ],
    ...overrides,
  };
}
