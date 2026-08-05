import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { readProductCategories } from "@/lib/shopify/shopifyTaxonomyMap";
import type { FashionSlotCatalogProduct } from "./types";

export type CategoryHedgeCoverage = {
  with_shopify_category: number;
  category_match_expected: number;
  unfiltered_lane_unique: number;
};

function categoryGidSuffix(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}

function productShopifyCategoryGids(product: FashionSlotCatalogProduct): string[] {
  const fromArray = readProductCategories(product.raw)
    .map((c) => c.id ?? c.gid)
    .filter((id): id is string => Boolean(id?.trim()));
  if (fromArray.length) return fromArray;

  const tax = product.taxonomy_category?.trim();
  if (!tax) return [];
  if (tax.includes("TaxonomyCategory/")) return [tax];
  return [];
}

export function productCategoryMatchesExpectedGids(
  product: FashionSlotCatalogProduct,
  expectedGids: string[],
): boolean {
  if (!expectedGids.length) return false;
  const expected = new Set(expectedGids);
  const expectedSuffixes = new Set(expectedGids.map(categoryGidSuffix));
  const productGids = productShopifyCategoryGids(product);

  for (const gid of productGids) {
    if (expected.has(gid)) return true;
    const suffix = categoryGidSuffix(gid);
    if (expectedSuffixes.has(suffix)) return true;
    // Ancestors / descendants: aa-8 ↔ aa-8-8
    for (const expectedSuffix of expectedSuffixes) {
      if (
        suffix.startsWith(`${expectedSuffix}-`) ||
        expectedSuffix.startsWith(`${suffix}-`)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** True when the product has a Shopify taxonomy category outside the expected family. */
export function productCategoryOutsideExpectedGids(
  product: FashionSlotCatalogProduct,
  expectedGids: string[],
): { mismatch: true; evidence: string } | { mismatch: false } {
  if (!expectedGids.length) return { mismatch: false };
  const productGids = productShopifyCategoryGids(product);
  if (!productGids.length) return { mismatch: false }; // unknown never drops
  if (productCategoryMatchesExpectedGids(product, expectedGids)) {
    return { mismatch: false };
  }
  return {
    mismatch: true,
    evidence: productGids.join(", "),
  };
}

export function summarizeCategoryHedgeCoverage(params: {
  products: FashionSlotCatalogProduct[];
  expectedCategoryGids: string[];
  unfilteredVariantIndices: Set<number>;
}): CategoryHedgeCoverage {
  let with_shopify_category = 0;
  let category_match_expected = 0;
  let unfiltered_lane_unique = 0;

  for (const product of params.products) {
    const gids = productShopifyCategoryGids(product);
    if (gids.length) with_shopify_category += 1;

    if (product.matched_only_unfiltered) unfiltered_lane_unique += 1;

    const fromUnfilteredLane = product.matched_by.some((idx) =>
      params.unfilteredVariantIndices.has(idx),
    );
    if (
      fromUnfilteredLane &&
      productCategoryMatchesExpectedGids(product, params.expectedCategoryGids)
    ) {
      category_match_expected += 1;
    }
  }

  return {
    with_shopify_category,
    category_match_expected,
    unfiltered_lane_unique,
  };
}

/** @internal test helper — categories on a raw search hit. */
export function rawProductHasShopifyCategory(raw: CatalogProductSummary): boolean {
  return readProductCategories(raw).some((c) => Boolean(c.id ?? c.gid));
}
