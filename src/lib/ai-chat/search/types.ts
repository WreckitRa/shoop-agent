/**
 * Core types for the rebuilt search + curation engine.
 *
 * See docs/search-improvements.md. The engine interprets a user request into a
 * structured `SearchBrief` (Stage 0), fans out a query portfolio (Stage 1),
 * pools + de-dupes by UPID (Stage 2), scores with Shoop's own ranking (Stage
 * 3), verifies availability (Stage 4), and slots picks (Stage 5).
 */
import type {
  CatalogLikeItem,
  CatalogProductSummary,
} from "@/lib/shopify/catalog";

import type { BriefProvenance } from "./brief-provenance";

/** The four request archetypes — these replace the legacy "shopping modes". */
export type Archetype = "specific" | "broad" | "gift_directed" | "gift_vague";

/** Budget enforcement strength selected at interpretation time. */
export type BudgetType = "hard" | "soft" | "none";

/** Drives the composite scoring weights (Stage 3). */
export type RankingProfile =
  | "relevance_first"
  | "balanced"
  | "value_first"
  | "gift_diversity";

/** Query/scope gender, never applied to a gift recipient. */
export type GenderScope = "mens" | "womens" | "unisex" | "unknown";

export type RecipientKind = "self" | "other";

export type SearchBriefBudget = {
  /** Target / ceiling in MINOR units (cents). Null = no target. */
  amountCents: number | null;
  /** Optional floor from budget slider / filters (minor units). */
  minCents?: number | null;
  /** Optional ceiling — mirrors amountCents when set from clarification. */
  maxCents?: number | null;
  type: BudgetType;
  currency: string;
};

export type VariantConstraints = {
  size?: string;
  color?: string;
  other?: Record<string, string>;
};

export type BriefRecipient = {
  kind: RecipientKind;
  label?: string;
  name?: string;
  ageRange?: string;
  knownInterests?: string[];
  favoriteBrands?: string[];
};

/**
 * Structured interpretation of a single shopping intent. Multi-intent requests
 * ("shoes and a jacket") produce SEPARATE briefs — never blended.
 */
export type SearchBrief = {
  archetype: Archetype;
  /** Seed phrase — core noun + 2-4 strong attributes (no multi-intent). */
  query: string;
  category?: string;
  useCase?: string;
  mustHaves: string[];
  niceToHaves: string[];
  budget: SearchBriefBudget;
  variantConstraints: VariantConstraints;
  genderScope: GenderScope;
  recipient: BriefRecipient;
  rankingProfile: RankingProfile;
  /** Defaults to ["new"] unless the user signals secondhand. */
  condition?: string[];
  /** "More like this" — endorsed/purchased product ids for `catalog.like`. */
  similarToProductIds?: string[];
  /** Set when this brief is a chosen gift direction (grouped output). */
  directionLabel?: string;
  /** Per-field provenance for honest weighting and explanation. */
  provenance?: BriefProvenance;
};

/** Default per-archetype ranking profile. */
export const DEFAULT_RANKING_PROFILE: Record<Archetype, RankingProfile> = {
  specific: "relevance_first",
  broad: "balanced",
  gift_directed: "gift_diversity",
  gift_vague: "gift_diversity",
};

export type ScoreWeights = {
  relPrior: number;
  quality: number;
  popularity: number;
  value: number;
  fit: number;
  gem: number;
};

/** Stage 3 weights by ranking profile (docs/search-improvements.md §9). */
export const RANKING_WEIGHTS: Record<RankingProfile, ScoreWeights> = {
  // r .45, q .20, p .10, v .05, f .15, g .05
  relevance_first: {
    relPrior: 0.45,
    quality: 0.2,
    popularity: 0.1,
    value: 0.05,
    fit: 0.15,
    gem: 0.05,
  },
  // r .25, q .25, p .10, v .15, f .20, g .05
  balanced: {
    relPrior: 0.25,
    quality: 0.25,
    popularity: 0.1,
    value: 0.15,
    fit: 0.2,
    gem: 0.05,
  },
  // r .20, q .20, p .10, v .30, f .15, g .05
  value_first: {
    relPrior: 0.2,
    quality: 0.2,
    popularity: 0.1,
    value: 0.3,
    fit: 0.15,
    gem: 0.05,
  },
  // recipient-fit .35, q .25, p .10, v .10, g .10 (relevance folded into fit)
  gift_diversity: {
    relPrior: 0.1,
    quality: 0.25,
    popularity: 0.1,
    value: 0.1,
    fit: 0.35,
    gem: 0.1,
  },
};

/** A single fan-out query within a portfolio. */
export type PortfolioQuery = {
  id: string;
  text: string;
  intent?: string;
  wave: 1 | 2;
  priceMinCents?: number;
  priceMaxCents?: number;
  condition?: string[];
  categoryGid?: string;
  /** Discovery query with adjacent vocabulary (feeds the Gem signal). */
  isDiscovery?: boolean;
  /** Sub-brief direction label for grouped gift output. */
  directionLabel?: string;
  /** Marks queries fired during thin-pool widening (drop price.max). */
  loosened?: boolean;
  /** Catalog similarity anchor (product id or image). */
  like?: CatalogLikeItem[];
};

/** Which portfolio query surfaced a candidate, and at what rank. */
export type QuerySource = {
  queryId: string;
  rank: number;
  isDiscovery?: boolean;
  directionLabel?: string;
};

/** A de-duplicated candidate in the per-request pool. */
export type PoolCandidate = {
  product: CatalogProductSummary;
  /** Dedupe key — UPID when present, else product id. */
  upid: string;
  sources: QuerySource[];
  bestRank: number;
  /** Number of distinct portfolio queries that surfaced this UPID. */
  corroboration: number;
  /** True when surfaced (only) by a discovery query. */
  fromDiscovery: boolean;
  directionLabel?: string;
  /** Set when this candidate entered via a loosened (budget-relaxed) query. */
  loosened?: boolean;
  /** Set when merged from clarification preview warm cache. */
  fromWarmCache?: boolean;
};

export type ScoreBreakdown = {
  relPrior: number;
  quality: number;
  popularity: number;
  value: number;
  fit: number;
  gem: number;
  penalties: number;
  /** Soft penalty from structured constraint partial violations. */
  constraintPenalty: number;
  total: number;
};

export type ScoredCandidate = PoolCandidate & {
  score: number;
  breakdown: ScoreBreakdown;
  /** False when rating is missing — ineligible for the hero slot. */
  heroEligible: boolean;
  sellerDomain: string | null;
};
