/**
 * Bayesian rating-confidence heuristic for tier judgment.
 * Small-n perfect ratings are weak evidence — clamp LLM confidence.
 */
import { parseCatalogRating, type CatalogProductSummary } from "@/lib/shopify/catalog";
import type { TierConfidence } from "./tier-judge";

const PRIOR_MEAN = 4.2;
const PRIOR_COUNT = 20;

export function bayesianAdjustedRating(product: CatalogProductSummary): {
  adjusted: number;
  count: number;
  raw: number | null;
} {
  const r = parseCatalogRating(product.rating);
  if (!r) return { adjusted: PRIOR_MEAN, count: 0, raw: null };
  const scale = r.scaleMax || 5;
  const rawNorm = r.value;
  const count = r.count ?? 0;
  const adjusted =
    (count * rawNorm + PRIOR_COUNT * PRIOR_MEAN) / (count + PRIOR_COUNT);
  return { adjusted, count, raw: rawNorm };
}

/** Clamp model-assigned confidence using review-count literacy. */
export function clampTierConfidenceFromRating(
  product: CatalogProductSummary,
  llmConfidence: TierConfidence,
): TierConfidence {
  const { adjusted, count, raw } = bayesianAdjustedRating(product);
  const scale = parseCatalogRating(product.rating)?.scaleMax ?? 5;
  const highRaw = raw != null && raw / scale >= 0.9;

  if (count < 5) return "limited";
  if (count < 30 && highRaw) return llmConfidence === "strong" ? "moderate" : "limited";
  if (count < 100 && adjusted < 4.0) return "limited";
  if (count >= 500 && adjusted >= 4.1) {
    return llmConfidence === "limited" ? "moderate" : llmConfidence;
  }
  return llmConfidence;
}
