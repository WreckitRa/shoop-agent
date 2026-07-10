/**
 * Stage 3 — Composite Shoop Scoring (docs/search-improvements.md §9).
 *
 *   Score = w_r·RelPrior + w_q·Quality + w_p·Popularity + w_v·Value
 *           + w_f·Fit + w_g·Gem − Penalties
 *
 * Weights come from the ranking profile. This is what makes Shoop's ordering
 * its own opinion rather than the raw catalog relevance order. Hard-budget
 * violations are excluded; a per-seller cap is enforced after sorting.
 */
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import {
  parseCatalogRating,
  type CatalogProductSummary,
} from "@/lib/shopify/catalog";
import { cosineSimilarity } from "./voyage";
import type { SimilarScoringParams } from "./find-similar/similar-scoring";
import { similarRelPrior, similarValueScore } from "./find-similar/similar-scoring";
import {
  candidatePriceCentsForBuyer,
} from "./pool";
import type { FxRateTable } from "@/lib/shopify/fx-rates";
import {
  budgetAlignmentScore,
  BUDGET_ALIGNMENT_WEIGHT,
  giftFloorPenalty,
  judgePriceAgainstBudget,
} from "./budget";
import {
  isAnchorBrandProduct,
  ANCHOR_BRAND_SCORE_BONUS,
} from "./brand-anchors";
import {
  colorConstraintViolation,
  genderConstraintViolation,
  mustHaveColorViolation,
} from "./constraint-gate";
import { effectiveCorroboration } from "./pool-health";
import { noveltyMerchPenalty } from "./novelty-merch";
import { QUALITY_FLOOR_STARS } from "./slot-eligibility";
import {
  RANKING_WEIGHTS,
  type PoolCandidate,
  type ScoreBreakdown,
  type ScoredCandidate,
  type SearchBrief,
} from "./types";

/** Bayesian prior mean rating (on a 5-point scale) → normalized. */
const QUALITY_PRIOR_MEAN_NORM = 4.2 / 5;
/** Bayesian prior strength (pseudo-count). */
const QUALITY_PRIOR_COUNT = 20;
/** Minimum reviews for a candidate to be hero-eligible. */
const HERO_MIN_REVIEWS = 5;
/** Max picks per seller before the cap penalty kicks in. */
const PER_SELLER_CAP = 2;
const SELLER_CAP_PENALTY = 0.5;
const FEEDBACK_PENALTY = 0.6;
const CONSTRAINT_PENALTY_WEIGHT = 0.35;

export type FeedbackAvoidSet = {
  avoidUpids: Set<string>;
  avoidProductIds: Set<string>;
  /** Lowercased rejected attribute tokens (brand/material/color/style). */
  avoidAttributes: string[];
};

export type ScoringContext = {
  brief: SearchBrief;
  pool: PoolCandidate[];
  /** Buyer/recipient taste embedding (Voyage); null degrades Fit to attributes. */
  tasteVector?: number[] | null;
  /** upid -> candidate embedding (Voyage); absent degrades Fit to attributes. */
  candidateVectors?: Map<string, number[]>;
  feedback?: FeedbackAvoidSet;
  /** Find-similar mode — attribute-anchored scoring. */
  similar?: SimilarScoringParams;
  /** Buyer ISO currency — prices are normalized here before budget/value scoring. */
  buyerCurrency?: string | null;
  /** Daily-cached FX table for cross-presentment normalization. */
  fxTable?: FxRateTable | null;
};

function shopDomainFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export function candidateSellerDomain(
  product: CatalogProductSummary,
): string | null {
  const raw = product as unknown as Record<string, unknown>;
  const seller = raw.seller as { domain?: string; url?: string } | undefined;
  if (seller?.domain) return seller.domain.replace(/^www\./i, "");
  if (seller?.url) return shopDomainFromUrl(seller.url);
  const checkout = product.variants?.[0]?.checkout_url;
  return shopDomainFromUrl(checkout);
}

function candidateText(product: CatalogProductSummary): string {
  const parts: string[] = [product.title ?? ""];
  for (const a of extractCatalogAttributes(product)) {
    parts.push(a.name, a.value);
  }
  for (const opt of product.options ?? []) {
    parts.push(opt.name);
    for (const v of opt.values ?? []) parts.push(v.label);
  }
  return parts.join(" ").toLowerCase();
}

function reviewCount(product: CatalogProductSummary): number {
  const r = parseCatalogRating(product.rating);
  return r?.count ?? 0;
}

function ratingNorm(product: CatalogProductSummary): number | null {
  const r = parseCatalogRating(product.rating);
  if (!r) return null;
  const scale = r.scaleMax || 5;
  return Math.max(0, Math.min(1, r.value / scale));
}

function relPrior(c: PoolCandidate): number {
  const decay = 1 / (1 + c.bestRank * 0.15);
  const corroborationBonus =
    Math.min(effectiveCorroboration(c) - 1, 3) * 0.05;
  return Math.max(0, Math.min(1, decay + corroborationBonus));
}

function bayesianQuality(product: CatalogProductSummary): {
  quality: number;
  hasRating: boolean;
} {
  const rn = ratingNorm(product);
  if (rn == null) return { quality: 0.5, hasRating: false };
  const count = reviewCount(product);
  const quality =
    (count * rn + QUALITY_PRIOR_COUNT * QUALITY_PRIOR_MEAN_NORM) /
    (count + QUALITY_PRIOR_COUNT);
  return { quality: Math.max(0, Math.min(1, quality)), hasRating: true };
}

function attributeFit(brief: SearchBrief, text: string): number {
  const mustTokens = brief.mustHaves
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);
  const niceTokens = [
    ...brief.niceToHaves,
    ...(brief.recipient.knownInterests ?? []),
    ...(brief.directionLabel ? [brief.directionLabel] : []),
  ]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);

  let mustHits = 0;
  for (const t of mustTokens) {
    if (text.includes(t)) mustHits += 1;
  }
  let niceHits = 0;
  for (const t of niceTokens) {
    if (text.includes(t)) niceHits += 1;
  }

  const mustScore = mustTokens.length ? mustHits / mustTokens.length : 0.5;
  const niceScore = niceTokens.length ? niceHits / niceTokens.length : 0.5;
  return 0.7 * mustScore + 0.3 * niceScore;
}

/** Soft penalty when structured constraints are partially violated (hard drops happen later). */
export function constraintFitPenalty(brief: SearchBrief, text: string): number {
  if (
    genderConstraintViolation(brief, text) ||
    colorConstraintViolation(brief, text) ||
    mustHaveColorViolation(brief, text)
  ) {
    return 1;
  }
  const mustTokens = brief.mustHaves
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 4);
  if (!mustTokens.length) return 0;
  const misses = mustTokens.filter((t) => !text.includes(t)).length;
  return Math.min(1, misses / mustTokens.length);
}

function gemScore(product: CatalogProductSummary, c: PoolCandidate): number {
  const rn = ratingNorm(product);
  if (rn == null) return 0;
  const reviews = reviewCount(product);
  const highRating = rn >= 0.9;
  const modestReviews = reviews >= 3 && reviews <= 150;
  if (!highRating || !modestReviews) return 0;
  return c.fromDiscovery ? 1 : 0.6;
}

/** Price percentile within the pool (0 = cheapest, 1 = most expensive). */
function buildPricePercentiles(
  pool: PoolCandidate[],
  buyerCurrency?: string | null,
  fxTable?: FxRateTable | null,
): Map<string, number> {
  const priced = pool
    .map((c) => ({
      upid: c.upid,
      price: candidatePriceCentsForBuyer(c.product, buyerCurrency, fxTable),
    }))
    .filter((x): x is { upid: string; price: number } => x.price != null)
    .sort((a, b) => a.price - b.price);
  const out = new Map<string, number>();
  const n = priced.length;
  if (n === 0) return out;
  for (let i = 0; i < n; i++) {
    out.set(priced[i]!.upid, n === 1 ? 0.5 : i / (n - 1));
  }
  return out;
}

function feedbackPenalty(
  c: PoolCandidate,
  text: string,
  feedback: FeedbackAvoidSet | undefined,
): number {
  if (!feedback) return 0;
  if (feedback.avoidUpids.has(c.upid) || feedback.avoidProductIds.has(c.product.id)) {
    return FEEDBACK_PENALTY;
  }
  for (const attr of feedback.avoidAttributes) {
    if (attr && text.includes(attr)) return FEEDBACK_PENALTY;
  }
  return 0;
}

/**
 * Score + rank the pool. Hard-budget violations are excluded; soft over-budget
 * candidates stay (the "earn the overage" rule is enforced in slotting). The
 * per-seller cap is applied after the initial sort.
 */
export function scorePool(ctx: ScoringContext): ScoredCandidate[] {
  const { brief, pool } = ctx;
  const similarMode = Boolean(ctx.similar);
  const weights = similarMode
    ? {
        relPrior: 0.45,
        quality: 0.15,
        popularity: 0.08,
        value: 0.1,
        fit: 0.05,
        gem: 0.05,
      }
    : RANKING_WEIGHTS[brief.rankingProfile];
  const isGift =
    brief.archetype === "gift_directed" || brief.archetype === "gift_vague";

  // Popularity normalizer.
  let maxPop = 0;
  for (const c of pool) {
    const pop = Math.log10(1 + reviewCount(c.product));
    if (pop > maxPop) maxPop = pop;
  }

  const pricePct = buildPricePercentiles(pool, ctx.buyerCurrency, ctx.fxTable);

  const scored: ScoredCandidate[] = [];
  for (const c of pool) {
    const product = c.product;
    const price = candidatePriceCentsForBuyer(
      product,
      ctx.buyerCurrency,
      ctx.fxTable,
    );
    const verdict = judgePriceAgainstBudget(price, brief.budget, { isGift });
    if (verdict.hardViolation) continue; // hard budget excludes outright.

    const text = candidateText(product);
    const rel = similarMode && ctx.similar
      ? similarRelPrior(c, ctx.similar, ctx.candidateVectors)
      : relPrior(c);
    const { quality, hasRating } = bayesianQuality(product);
    const pop = maxPop > 0 ? Math.log10(1 + reviewCount(product)) / maxPop : 0;

    const pct = pricePct.get(c.upid) ?? 0.5;
    const value =
      similarMode && ctx.similar
        ? similarValueScore(price, ctx.similar.seedPriceCents)
        : Math.max(0, Math.min(1, (quality - pct + 1) / 2));

    // Fit: Voyage cosine for self-shopping only; gifts use interests/direction.
    const attrFit = attributeFit(brief, text);
    const constraintPenalty = constraintFitPenalty(brief, text);
    let fit = attrFit * (1 - constraintPenalty * 0.5);
    const vec = ctx.candidateVectors?.get(c.upid);
    const useTasteVector =
      !similarMode &&
      !isGift &&
      brief.recipient.kind === "self" &&
      ctx.tasteVector &&
      ctx.tasteVector.length &&
      vec &&
      vec.length;
    if (useTasteVector) {
      const cosNorm = (cosineSimilarity(ctx.tasteVector!, vec) + 1) / 2;
      fit = 0.7 * cosNorm + 0.3 * attrFit;
    }

    const gem = gemScore(product, c);
    const budgetAlign = budgetAlignmentScore(price, brief.budget, { isGift });

    let penalties = feedbackPenalty(c, text, ctx.feedback);
    penalties += giftFloorPenalty(price, brief.budget, isGift);
    penalties += noveltyMerchPenalty(product.title ?? "");
    penalties += CONSTRAINT_PENALTY_WEIGHT * constraintPenalty;

    const anchorBonus = isAnchorBrandProduct(product, brief.query, brief.category)
      ? ANCHOR_BRAND_SCORE_BONUS
      : 0;

    const total =
      weights.relPrior * rel +
      weights.quality * quality +
      weights.popularity * pop +
      weights.value * value +
      weights.fit * fit +
      weights.gem * gem +
      BUDGET_ALIGNMENT_WEIGHT * budgetAlign -
      penalties +
      anchorBonus;

    const breakdown: ScoreBreakdown = {
      relPrior: rel,
      quality,
      popularity: pop,
      value,
      fit,
      gem,
      penalties,
      constraintPenalty,
      total,
    };

    const rating = parseCatalogRating(product.rating);
    const heroEligible =
      hasRating &&
      reviewCount(product) >= HERO_MIN_REVIEWS &&
      penalties < FEEDBACK_PENALTY &&
      !verdict.over &&
      (rating == null || rating.value >= QUALITY_FLOOR_STARS);

    scored.push({
      ...c,
      score: total,
      breakdown,
      heroEligible,
      sellerDomain: candidateSellerDomain(product),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return applySellerCap(scored);
}

/** Demote 3rd+ candidates from the same seller (keeps variety). */
export function applySellerCap(scored: ScoredCandidate[]): ScoredCandidate[] {
  const counts = new Map<string, number>();
  for (const c of scored) {
    if (!c.sellerDomain) continue;
    const n = (counts.get(c.sellerDomain) ?? 0) + 1;
    counts.set(c.sellerDomain, n);
    if (n > PER_SELLER_CAP) {
      c.score -= SELLER_CAP_PENALTY;
      c.breakdown.penalties += SELLER_CAP_PENALTY;
      c.breakdown.total = c.score;
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Compact embedding text for a candidate (used by the engine's Voyage batch). */
export function candidateEmbeddingText(product: CatalogProductSummary): string {
  return candidateText(product).slice(0, 400);
}
