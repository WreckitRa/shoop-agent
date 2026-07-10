/**
 * Slot eligibility gates (search hardening Fix 3).
 *
 * Superlative labels require supporting data; leave a slot empty rather than
 * fabricate a label.
 */
import {
  parseCatalogRating,
  type CatalogProductDetail,
} from "@/lib/shopify/catalog";
import { titleTokenSimilarity } from "./query-diversity";
import type { VerifiedCandidate } from "./verify";

/** Minimum star rating (on a 5-point scale) for labeled picks when rated. */
export const QUALITY_FLOOR_STARS = 3.8;

/** Minimum review count for the "most popular" slot. */
export const MIN_REVIEWS_POPULAR = 25;

const QUALITY_FLOOR_NORM = QUALITY_FLOOR_STARS / 5;

export function ratingStars(detail: CatalogProductDetail): number | null {
  const r = parseCatalogRating(detail.rating);
  if (!r) return null;
  const scale = r.scaleMax || 5;
  return (r.value / scale) * 5;
}

export function reviewCount(detail: CatalogProductDetail): number {
  return parseCatalogRating(detail.rating)?.count ?? 0;
}

export function hasRating(detail: CatalogProductDetail): boolean {
  return parseCatalogRating(detail.rating) != null;
}

export function meetsQualityFloor(detail: CatalogProductDetail): boolean {
  const stars = ratingStars(detail);
  if (stars == null) return false;
  return stars >= QUALITY_FLOOR_STARS;
}

export function eligibleForShopPick(vc: VerifiedCandidate): boolean {
  if (!hasRating(vc.detail)) return vc.heroEligible;
  return meetsQualityFloor(vc.detail) && vc.heroEligible;
}

export function eligibleForBestValue(vc: VerifiedCandidate): boolean {
  if (vc.resolvedPriceCents == null) return false;
  if (!hasRating(vc.detail)) return false;
  return meetsQualityFloor(vc.detail);
}

export function eligibleForMostPopular(vc: VerifiedCandidate): boolean {
  if (!hasRating(vc.detail)) return false;
  if (!meetsQualityFloor(vc.detail)) return false;
  return reviewCount(vc.detail) >= MIN_REVIEWS_POPULAR;
}

export function eligibleForGem(vc: VerifiedCandidate): boolean {
  if (!hasRating(vc.detail)) return false;
  return meetsQualityFloor(vc.detail) && vc.breakdown.gem > 0;
}

export function nearDuplicateTitle(a: string, b: string, threshold = 0.5): boolean {
  return titleTokenSimilarity(a, b) >= threshold;
}

export function isNearDuplicateOfUsed(
  vc: VerifiedCandidate,
  used: VerifiedCandidate[],
): boolean {
  return used.some((u) =>
    nearDuplicateTitle(vc.detail.title, u.detail.title),
  );
}

/** Resolve judge-placed products to verified rows — featured slots use this, not the raw verify pool. */
export function curatedVerifiedFromPlacements(
  pool: VerifiedCandidate[],
  placements: Array<{ productId: string }>,
  resolveId: (pool: VerifiedCandidate[], productId: string) => VerifiedCandidate | undefined,
): VerifiedCandidate[] {
  const out: VerifiedCandidate[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    const vc = resolveId(pool, p.productId);
    if (!vc || seen.has(vc.upid)) continue;
    seen.add(vc.upid);
    out.push(vc);
  }
  return out;
}
