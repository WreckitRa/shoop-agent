import { readProductCategories } from "@/lib/ai-chat/search/shopifyTaxonomyMap";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import {
  isGenderedDepartment,
  resolveDepartmentEvidence,
  resolveSearchDepartment,
} from "../department";
import {
  recipientSizeForGarment,
  sizeCorresponds,
} from "../hard-drops/size-match";
import type { ProductSuspicion } from "../hard-drops/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionFactRow } from "../types";
import { statedBrands } from "../brand/brand-handling";
import { paletteComponentScore } from "./palette-match";
import {
  SCORING_COMPONENT_KEYS,
  SCORING_CONFIG,
  SCORING_WEIGHTS,
  SCORING_WEIGHTS_VERSION,
  type ScoringComponentKey,
} from "./weights";
import type { ProductScore, ScoreComponents } from "./types";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function scoreShopifyRank(bestRank: number): number {
  const k = SCORING_CONFIG.shopify_rank_k;
  return 1 / (1 + bestRank / k);
}

function productHasShopifyCategory(product: FashionSlotCatalogProduct): boolean {
  if (readProductCategories(product.raw).some((c) => c.id ?? c.gid)) return true;
  return Boolean(product.taxonomy_category?.trim());
}

export function scoreCorroboration(params: {
  variantCount: number;
  matchedOnlyUnfiltered: boolean;
  product: FashionSlotCatalogProduct;
}): number {
  let score = 0;
  if (params.variantCount >= 3) score = 1.0;
  else if (params.variantCount === 2) score = 0.6;

  if (params.matchedOnlyUnfiltered && score > 0.6) {
    if (!productHasShopifyCategory(params.product)) score = 0.6;
  }

  return score;
}

export function scoreSizeConfirmed(params: {
  product: FashionSlotCatalogProduct;
  garment: string;
  recipientFacts: FashionFactRow[];
}): number {
  const recipient = recipientSizeForGarment(params.recipientFacts, params.garment);
  if (!recipient) return 0;

  const sizes = params.product.normalized?.sizes ?? [];
  for (const field of sizes) {
    if (field.status !== "resolved" || !field.size) continue;
    if (sizeCorresponds(field.size, recipient) === "exact") return 1.0;
  }
  return 0;
}

export function scoreRating(product: FashionSlotCatalogProduct): number {
  const value = product.rating_value;
  const count = product.review_count;
  if (value == null || count == null || count <= 0) return 0.5;

  const prior = SCORING_CONFIG.rating_prior;
  const c = SCORING_CONFIG.rating_prior_count;
  const b = (c * prior + count * value) / (c + count);
  return clamp01(0.5 + (b - prior) * 0.5);
}

export function isSizeComponentActive(
  brief: FashionSearchBrief,
  garment: string,
  recipientFacts: FashionFactRow[],
): boolean {
  if (brief.knowledge_state?.sizes_unconfirmed.includes(garment)) return false;
  return recipientSizeForGarment(recipientFacts, garment) != null;
}

export function isPaletteComponentActive(slot: FashionSearchPlanSlot): boolean {
  if (slot.palette_source === "spread") return false;
  return Boolean(slot.palette_constraint?.trim());
}

export function isDepartmentComponentActive(brief: FashionSearchBrief): boolean {
  const department = resolveSearchDepartment({
    knowledgeDepartment: brief.knowledge_state?.department,
    departmentScope: brief.department_scope,
  });
  return isGenderedDepartment(department);
}

/**
 * Active only for stated brands. Deactivates (weight redistributes) when the
 * slot translated with zero confirmed brand hits.
 */
export function isBrandComponentActive(
  brief: FashionSearchBrief,
  slot: FashionSearchPlanSlot,
): boolean {
  if (brief.brand_direction?.source !== "stated") return false;
  if (!statedBrands(brief).length) return false;
  if (
    slot.brand_status === "translated" &&
    (slot.brand_confirmed_count ?? 0) === 0
  ) {
    return false;
  }
  return true;
}

export function scoreBrandMatch(product: FashionSlotCatalogProduct): number {
  return product.brand_confirmed === true ? 1.0 : 0;
}

/** Boost-only: confirmed_match → 1.0; unknown → 0 (neutral, never negative). */
export function scoreDepartmentConfirmed(params: {
  product: FashionSlotCatalogProduct;
  brief: FashionSearchBrief;
}): number {
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.brief.knowledge_state?.department,
    departmentScope: params.brief.department_scope,
  });
  if (!isGenderedDepartment(department)) return 0;
  const evidence = resolveDepartmentEvidence(
    {
      title: params.product.title ?? "",
      taxonomyCategory: params.product.taxonomy_category,
      attributes: extractCatalogAttributes(params.product.raw),
      shopGid: params.product.merchant_id?.startsWith("gid://shopify/Shop/")
        ? params.product.merchant_id
        : null,
      shopDomain: params.product.shop_domain,
    },
    department,
  );
  return evidence.status === "confirmed_match" ? 1.0 : 0;
}

export function renormalizedWeights(active: ScoringComponentKey[]): Record<
  ScoringComponentKey,
  number
> {
  const rawSum = active.reduce(
    (sum, key) => sum + SCORING_WEIGHTS[key],
    0,
  );
  const out = {} as Record<ScoringComponentKey, number>;
  for (const key of active) {
    out[key] = SCORING_WEIGHTS[key] / rawSum;
  }
  return out;
}

export function suspicionPenaltyCount(suspicions: ProductSuspicion[]): number {
  // department_unknown is informational only — must not sink unmarked inventory.
  return suspicions.filter((s) => s.rule !== "department_unknown").length;
}

export function computeSuspicionPenalty(flagCount: number): number {
  if (flagCount <= 0) return 0;
  return Math.min(
    SCORING_WEIGHTS.suspicion_penalty_cap,
    flagCount * SCORING_WEIGHTS.suspicion_penalty_per_flag,
  );
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

export function detectPriceOutlierLowSuspicions(
  products: FashionSlotCatalogProduct[],
): Map<string, ProductSuspicion> {
  const prices = products
    .map((p) => p.price?.amount)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const out = new Map<string, ProductSuspicion>();
  if (prices.length < 4) return out;

  const p5 = percentile(prices, SCORING_CONFIG.price_outlier_percentile);
  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const threshold = median * SCORING_CONFIG.price_outlier_median_ratio;

  for (const product of products) {
    const amount = product.price?.amount;
    if (amount == null) continue;
    if (amount <= p5 && amount < threshold) {
      out.set(product.id, {
        rule: "price_outlier_low",
        evidence: `price ${amount} below p5 ${p5} and 40% of median ${median}`,
        source_field: "price",
      });
    }
  }
  return out;
}

export function scoreProduct(params: {
  product: FashionSlotCatalogProduct;
  slot: FashionSearchPlanSlot;
  brief: FashionSearchBrief;
  recipientFacts: FashionFactRow[];
  bestRank: number;
  extraSuspicions?: ProductSuspicion[];
}): ProductScore {
  const sizeActive = isSizeComponentActive(
    params.brief,
    params.slot.garment,
    params.recipientFacts,
  );
  const paletteActive = isPaletteComponentActive(params.slot);
  const departmentActive = isDepartmentComponentActive(params.brief);
  const brandActive = isBrandComponentActive(params.brief, params.slot);
  const active: ScoringComponentKey[] = SCORING_COMPONENT_KEYS.filter((key) => {
    if (key === "size_confirmed") return sizeActive;
    if (key === "palette") return paletteActive;
    if (key === "department_confirmed") return departmentActive;
    if (key === "brand_match") return brandActive;
    return true;
  });

  const components: ScoreComponents = {
    shopify_rank: scoreShopifyRank(params.bestRank),
    corroboration: scoreCorroboration({
      variantCount: params.product.matched_by.length,
      matchedOnlyUnfiltered: params.product.matched_only_unfiltered === true,
      product: params.product,
    }),
    size_confirmed: sizeActive
      ? scoreSizeConfirmed({
          product: params.product,
          garment: params.slot.garment,
          recipientFacts: params.recipientFacts,
        })
      : 0,
    rating: scoreRating(params.product),
    palette: paletteActive
      ? paletteComponentScore({
          buckets: params.product.normalized?.colors.buckets ?? [],
          colorStatus: params.product.normalized?.colors.status ?? "unknown",
          constraint: params.slot.palette_constraint ?? "",
          source: params.slot.palette_source,
        })
      : 0,
    department_confirmed: departmentActive
      ? scoreDepartmentConfirmed({
          product: params.product,
          brief: params.brief,
        })
      : 0,
    brand_match: brandActive ? scoreBrandMatch(params.product) : 0,
  };

  const weights = renormalizedWeights(active);
  let weighted = 0;
  for (const key of active) {
    weighted += components[key] * weights[key]!;
  }

  const suspicions = [
    ...(params.product.suspicions ?? []),
    ...(params.extraSuspicions ?? []),
  ];
  const penalties = computeSuspicionPenalty(suspicionPenaltyCount(suspicions));

  return {
    final: clamp01(weighted - penalties),
    components,
    active_components: active,
    penalties_applied: penalties,
    weights_version: SCORING_WEIGHTS_VERSION,
  };
}
