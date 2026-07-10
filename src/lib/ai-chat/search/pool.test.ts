import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { candidatePriceCents, productUpid } from "./pool";

const product = (over: Record<string, unknown>): CatalogProductSummary =>
  ({ id: "gid://x/1", title: "Thing", ...over }) as unknown as CatalogProductSummary;

describe("productUpid", () => {
  it("prefers an explicit universal product id", () => {
    assert.equal(productUpid(product({ upid: "U-42" })), "U-42");
    assert.equal(
      productUpid(product({ universalProductId: "U-7", id: "gid://x/9" })),
      "U-7",
    );
  });

  it("falls back to the product id when no cluster id exists", () => {
    assert.equal(productUpid(product({ id: "gid://x/123" })), "gid://x/123");
  });

  it("collapses cross-merchant duplicates to one key", () => {
    const a = product({ upid: "SHARED", id: "gid://merchantA/1" });
    const b = product({ upid: "SHARED", id: "gid://merchantB/2" });
    const seen = new Set([productUpid(a), productUpid(b)]);
    assert.equal(seen.size, 1);
  });
});

describe("candidatePriceCents", () => {
  it("reads the first variant price", () => {
    assert.equal(
      candidatePriceCents(
        product({ variants: [{ price: { amount: 4_999, currency: "USD" } }] }),
      ),
      4_999,
    );
  });

  it("falls back to the price range minimum", () => {
    assert.equal(
      candidatePriceCents(
        product({ price_range: { min: { amount: 1_500, currency: "USD" } } }),
      ),
      1_500,
    );
  });

  it("returns null when there is no price", () => {
    assert.equal(candidatePriceCents(product({})), null);
  });
});
