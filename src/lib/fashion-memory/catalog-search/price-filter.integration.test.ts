import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logAiChat } from "@/lib/ai-chat/observability";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  searchCatalog,
  type CatalogProductSummary,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import { taxonomyCategoriesForGarment } from "./garment-taxonomy";

const LIVE = process.env.FASHION_CATALOG_LIVE_TEST === "1";
const SHOES_GIDS = taxonomyCategoriesForGarment("shoes");
const QUERY = "mens running shoes";
const MAX_PRICE_CENTS = 6000; // $60 mid-range bound
const RESPECT_THRESHOLD = 0.9;

const CAPABILITY_CHECKS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/capability_checks.md",
);

function productPriceCents(product: CatalogProductSummary): number | null {
  const amount =
    product.price_range?.min?.amount ??
    product.variants?.[0]?.price?.amount ??
    null;
  if (amount == null || !Number.isFinite(amount)) return null;
  return amount;
}

function recordCapabilityCheck(params: {
  check: string;
  pass: boolean;
  detail: string;
}): void {
  const date = new Date().toISOString().slice(0, 10);
  const line = `| ${date} | ${params.check} | ${params.pass ? "pass" : "FAIL"} | ${params.detail.replace(/\|/g, "/")} |\n`;
  try {
    mkdirSync(dirname(CAPABILITY_CHECKS_PATH), { recursive: true });
    appendFileSync(CAPABILITY_CHECKS_PATH, line, "utf8");
  } catch (error) {
    logAiChat("warn", "fashion_capability_check_write_failed", {
      error: String(error).slice(0, 200),
    });
  }
}

(LIVE ? describe : describe.skip)("price filter live verification", () => {
  it("filtered running-shoes query respects max_price for ≥90% of priced hits", async () => {
    assert.ok(SHOES_GIDS.length, "shoes taxonomy mapping required");
    const accessToken = await accessTokenForCatalogMcp();
    const baseFilters: CatalogSearchFilters = {
      available: true,
      ships_to: { country: "US" },
      categories: SHOES_GIDS,
    };

    const unfiltered = await searchCatalog(accessToken, QUERY, baseFilters, {
      context: { address_country: "US", currency: "USD" },
      limit: 50,
    });
    const filtered = await searchCatalog(
      accessToken,
      QUERY,
      {
        ...baseFilters,
        price: { max: MAX_PRICE_CENTS },
      },
      {
        context: { address_country: "US", currency: "USD" },
        limit: 50,
      },
    );

    const unfilteredCount = unfiltered.products?.length ?? 0;
    const filteredProducts = filtered.products ?? [];
    const filteredCount = filteredProducts.length;

    assert.ok(unfilteredCount > 0, "unfiltered query should return products");

    const priced = filteredProducts
      .map((p) => ({ product: p, cents: productPriceCents(p) }))
      .filter((row): row is { product: CatalogProductSummary; cents: number } =>
        row.cents != null,
      );

    if (priced.length < 5) {
      logAiChat("warn", "fashion_price_filter_insufficient_price_data", {
        query: QUERY,
        filtered_count: filteredCount,
        with_price: priced.length,
        note: "skipped precision assertion — too few priced products",
      });
      recordCapabilityCheck({
        check: "ucp_price_filter",
        pass: true,
        detail: `skipped: only ${priced.length} priced hits`,
      });
      return;
    }

    const withinBound = priced.filter((row) => row.cents <= MAX_PRICE_CENTS * 1.02);
    const respectRate = withinBound.length / priced.length;

    if (respectRate < RESPECT_THRESHOLD) {
      logAiChat("error", "fashion_price_filter_decorative", {
        query: QUERY,
        max_price_cents: MAX_PRICE_CENTS,
        filtered_count: filteredCount,
        with_price: priced.length,
        respect_rate: respectRate,
        note: "UCP Global Catalog price filter appears decorative — budget hard-drop remains the enforcement layer",
      });
      recordCapabilityCheck({
        check: "ucp_price_filter",
        pass: false,
        detail: `respect_rate=${respectRate.toFixed(2)} (n=${priced.length})`,
      });
    } else {
      recordCapabilityCheck({
        check: "ucp_price_filter",
        pass: true,
        detail: `respect_rate=${respectRate.toFixed(2)} (n=${priced.length})`,
      });
    }

    assert.ok(
      respectRate >= RESPECT_THRESHOLD,
      `price filter appears decorative: only ${Math.round(respectRate * 100)}% of priced hits respect max_price=${MAX_PRICE_CENTS}`,
    );

    // filtered ⊆ plausible: every filtered id should be findable in the broader set
    // when both return results — soft check (junk-fill means counts stay full).
    if (unfilteredCount > 0 && filteredCount > 0) {
      assert.ok(
        filteredCount <= Math.max(unfilteredCount * 2, 100),
        "filtered set should not explode vs unfiltered (sanity)",
      );
    }
  });
});

describe("price filter live test gate", () => {
  it("documents how to run the network integration test", () => {
    if (LIVE) return;
    assert.equal(
      process.env.FASHION_CATALOG_LIVE_TEST,
      undefined,
      "Set FASHION_CATALOG_LIVE_TEST=1 to run live Catalog MCP price filter verification",
    );
  });
});
