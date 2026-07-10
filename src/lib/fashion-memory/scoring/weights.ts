/** Scoring weights — single source of truth for funnel ranking. */
export const SCORING_WEIGHTS = {
  shopify_rank: 0.32,
  corroboration: 0.11,
  size_confirmed: 0.09,
  rating: 0.09,
  palette: 0.11,
  department_confirmed: 0.08,
  /** Stated brand is a binding constraint — weigh like one. */
  brand_match: 0.2,
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

/** Bump when weights/config change so old traces stay interpretable. */
export const SCORING_WEIGHTS_VERSION = "20260709-v3-brand";

export type ScoringComponentKey =
  | "shopify_rank"
  | "corroboration"
  | "size_confirmed"
  | "rating"
  | "palette"
  | "department_confirmed"
  | "brand_match";

export const SCORING_COMPONENT_KEYS: ScoringComponentKey[] = [
  "shopify_rank",
  "corroboration",
  "size_confirmed",
  "rating",
  "palette",
  "department_confirmed",
  "brand_match",
];
