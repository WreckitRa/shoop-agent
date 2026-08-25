export type RequestType = "single_item" | "outfit" | "capsule" | "multi_item";
export type PreferenceAnchor = "keep" | "push" | "explore" | "unspecified";
export type DepthSource = "stated" | "you_decide" | "assumed";

export interface BriefDepth {
  looks_wanted?: number; // outfit / capsule
  options_per_item?: number; // single / multi
  source: DepthSource;
}

export interface FashionSearchBrief {
  recipient_person_id: string;
  request_type: RequestType;
  garments: string[];
  occasion_context: string;
  quantity_hint?: string;
  must_haves?: string[];
  nice_to_haves?: string[];
  budget_context: {
    stated: boolean;
    max?: number;
    currency?: string;
    scope?: "per_item" | "total";
    no_cap?: boolean;
  };
  style_direction: string;
  department_scope?: string;
  color_direction: { source: "stated" | "profile" | "none"; stated_colors?: string[] };
  brand_direction: { source: "stated" | "profile" | "none"; brands?: string[] };
  depth: BriefDepth;
  preference_anchor: PreferenceAnchor;
  consultation: { confirmed: string[]; rounds_used: 0 | 1 | 2 };
  assumptions: string[];
  stated_facts?: Record<string, unknown>;
}

/** Legacy briefs (pre-consultation) become well-formed with declared assumptions. */
export function upgradeLegacyBrief(b: Partial<FashionSearchBrief>): FashionSearchBrief {
  return {
    ...(b as FashionSearchBrief),
    depth: b.depth ?? { source: "assumed" },
    preference_anchor: b.preference_anchor ?? "unspecified",
    consultation: b.consultation ?? { confirmed: [], rounds_used: 0 },
    assumptions: b.assumptions ?? [],
  };
}
