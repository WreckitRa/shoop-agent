import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { logAiChat } from "@/lib/ai-chat/observability";
import { readProductCategories } from "@/lib/shopify/shopifyTaxonomyMap";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  searchCatalog,
  type CatalogProductSummary,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import { taxonomyCategoriesForGarment } from "./garment-taxonomy";
import { productCategoryMatchesExpectedGids } from "./category-coverage";
import { normalizeCatalogHit } from "./normalize-hit";
import { catalogDedupeKey } from "./product-id";

const LIVE = process.env.FASHION_CATALOG_LIVE_TEST === "1";
const JEANS_GIDS = taxonomyCategoriesForGarment("jeans");
const QUERY = "mens slim jeans";

function productsWithCategory(
  products: CatalogProductSummary[],
  expectedGids: string[],
): { withCategory: CatalogProductSummary[]; matchRate: number } {
  const withCategory = products.filter((p) => readProductCategories(p).length > 0);
  if (!withCategory.length) {
    return { withCategory, matchRate: 0 };
  }
  let matches = 0;
  for (const raw of withCategory) {
    const normalized = normalizeCatalogHit({
      raw,
      upid: catalogDedupeKey(raw),
      matched_by: [0],
      matched_by_color_variant: false,
    });
    if (productCategoryMatchesExpectedGids(normalized, expectedGids)) matches += 1;
  }
  return { withCategory, matchRate: matches / withCategory.length };
}

(LIVE ? describe : describe.skip)("category filter live verification", () => {
  it("filtered jeans query is smaller/equal and categories respect the GID filter", async () => {
    assert.ok(JEANS_GIDS.length, "jeans taxonomy mapping required");
    const accessToken = await accessTokenForCatalogMcp();
    const baseFilters: CatalogSearchFilters = {
      available: true,
      ships_to: { country: "US" },
    };
    const unfiltered = await searchCatalog(accessToken, QUERY, baseFilters, {
      context: { address_country: "US", currency: "USD" },
      limit: 50,
    });
    const filtered = await searchCatalog(accessToken, QUERY, {
      ...baseFilters,
      categories: JEANS_GIDS,
    }, {
      context: { address_country: "US", currency: "USD" },
      limit: 50,
    });

    const unfilteredCount = unfiltered.products?.length ?? 0;
    const filteredCount = filtered.products?.length ?? 0;

    assert.ok(unfilteredCount > 0, "unfiltered query should return products");
    assert.ok(
      filteredCount <= unfilteredCount,
      `filtered (${filteredCount}) should be <= unfiltered (${unfilteredCount})`,
    );

    const { withCategory, matchRate } = productsWithCategory(
      filtered.products ?? [],
      JEANS_GIDS,
    );

    if (withCategory.length >= 5) {
      if (matchRate < 0.8) {
        logAiChat("error", "fashion_category_filter_decorative", {
          query: QUERY,
          expected_gids: JEANS_GIDS,
          filtered_count: filteredCount,
          with_category: withCategory.length,
          match_rate: matchRate,
        });
      }
      assert.ok(
        matchRate >= 0.8,
        `category filter appears decorative: only ${Math.round(matchRate * 100)}% of categorized hits match expected GIDs`,
      );
    } else {
      logAiChat("warn", "fashion_category_filter_insufficient_category_data", {
        query: QUERY,
        filtered_count: filteredCount,
        with_category: withCategory.length,
        note: "skipped precision assertion — too few categorized products in filtered set",
      });
    }
  });
});

describe("category filter live test gate", () => {
  it("documents how to run the network integration test", () => {
    if (LIVE) return;
    assert.equal(
      process.env.FASHION_CATALOG_LIVE_TEST,
      undefined,
      "Set FASHION_CATALOG_LIVE_TEST=1 to run live Catalog MCP category filter verification",
    );
  });
});
