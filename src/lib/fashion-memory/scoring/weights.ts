/**
 * Scoring weights — single source of truth for funnel ranking.
 *
 * `SCORING_WEIGHTS_VERSION` env: `v3-brand` | `v4-taste` (aliases:
 * `20260709-v3-brand` | `20260828-v4-taste`). Default v4.
 * v3 is pre-S1 ranking: no taste_fit component, no taste rerank.
 */

export type ScoringWeightsAlias = "v3-brand" | "v4-taste";

export const SCORING_WEIGHTS_V3 = {
  taste_fit: 0,
  shopify_rank: 0.32,
  corroboration: 0.11,
  size_confirmed: 0.09,
  rating: 0.09,
  palette: 0.11,
  department_confirmed: 0.08,
  /** Active only when brand_direction.source === "stated". */
  brand_match: 0.2,
  suspicion_penalty_per_flag: 0.03,
  suspicion_penalty_cap: 0.08,
} as const;

export const SCORING_WEIGHTS_V4 = {
  taste_fit: 0.3,
  shopify_rank: 0.15,
  corroboration: 0.08,
  size_confirmed: 0.09,
  rating: 0.05,
  palette: 0.1,
  department_confirmed: 0.08,
  /** Active when brand_direction.source !== "none". */
  brand_match: 0.15,
  suspicion_penalty_per_flag: 0.03,
  suspicion_penalty_cap: 0.08,
} as const;

export const SCORING_CONFIG = {
  shopify_rank_k: 20,
  rating_prior: 4.0,
  rating_prior_count: 20,
  price_outlier_median_ratio: 0.4,
  price_outlier_percentile: 0.05,
} as const;

export type ScoringComponentKey =
  | "taste_fit"
  | "shopify_rank"
  | "corroboration"
  | "size_confirmed"
  | "rating"
  | "palette"
  | "department_confirmed"
  | "brand_match";

const V3_COMPONENT_KEYS: ScoringComponentKey[] = [
  "shopify_rank",
  "corroboration",
  "size_confirmed",
  "rating",
  "palette",
  "department_confirmed",
  "brand_match",
];

const V4_COMPONENT_KEYS: ScoringComponentKey[] = [
  "taste_fit",
  "shopify_rank",
  "corroboration",
  "size_confirmed",
  "rating",
  "palette",
  "department_confirmed",
  "brand_match",
];

export function resolveScoringWeightsAlias(): ScoringWeightsAlias {
  const raw = (process.env.SCORING_WEIGHTS_VERSION ?? "").trim();
  if (raw === "v3-brand" || raw === "20260709-v3-brand") return "v3-brand";
  return "v4-taste";
}

export function scoringWeightsVersion(): string {
  return resolveScoringWeightsAlias() === "v3-brand"
    ? "20260709-v3-brand"
    : "20260828-v4-taste";
}

export function isTasteScoringEnabled(): boolean {
  return resolveScoringWeightsAlias() === "v4-taste";
}

export function scoringWeights():
  | typeof SCORING_WEIGHTS_V3
  | typeof SCORING_WEIGHTS_V4 {
  return resolveScoringWeightsAlias() === "v3-brand"
    ? SCORING_WEIGHTS_V3
    : SCORING_WEIGHTS_V4;
}

export function scoringComponentKeys(): ScoringComponentKey[] {
  return resolveScoringWeightsAlias() === "v3-brand"
    ? V3_COMPONENT_KEYS
    : V4_COMPONENT_KEYS;
}

/** Active table. Property reads follow `SCORING_WEIGHTS_VERSION` at call time. */
export const SCORING_WEIGHTS = {
  get taste_fit() {
    return scoringWeights().taste_fit;
  },
  get shopify_rank() {
    return scoringWeights().shopify_rank;
  },
  get corroboration() {
    return scoringWeights().corroboration;
  },
  get size_confirmed() {
    return scoringWeights().size_confirmed;
  },
  get rating() {
    return scoringWeights().rating;
  },
  get palette() {
    return scoringWeights().palette;
  },
  get department_confirmed() {
    return scoringWeights().department_confirmed;
  },
  get brand_match() {
    return scoringWeights().brand_match;
  },
  get suspicion_penalty_per_flag() {
    return scoringWeights().suspicion_penalty_per_flag;
  },
  get suspicion_penalty_cap() {
    return scoringWeights().suspicion_penalty_cap;
  },
};
