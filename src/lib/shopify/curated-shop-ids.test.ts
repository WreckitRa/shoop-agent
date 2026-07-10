import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCuratedShopAllowlist, buildSearchCatalogRequest } from "./catalog";
import { CURATED_SHOP_IDS, isCuratedShopAllowlistEnabled } from "./curated-shop-ids";

describe("curated shop allowlist", () => {
  const prev = process.env.CATALOG_SHOP_ALLOWLIST;

  afterEach(() => {
    if (prev === undefined) delete process.env.CATALOG_SHOP_ALLOWLIST;
    else process.env.CATALOG_SHOP_ALLOWLIST = prev;
  });

  it("has harvested shop GIDs", () => {
    assert.ok(CURATED_SHOP_IDS.length > 100);
    assert.ok(
      CURATED_SHOP_IDS.every((id) => id.startsWith("gid://shopify/Shop/")),
    );
  });

  it("is disabled by default (opt-in)", () => {
    delete process.env.CATALOG_SHOP_ALLOWLIST;
    assert.equal(isCuratedShopAllowlistEnabled(), false);
  });

  it("can be enabled via env", () => {
    process.env.CATALOG_SHOP_ALLOWLIST = "1";
    assert.equal(isCuratedShopAllowlistEnabled(), true);
  });

  it("injects shop_ids into search_catalog requests when enabled", () => {
    process.env.CATALOG_SHOP_ALLOWLIST = "1";
    const req = buildSearchCatalogRequest("navy blazer", { available: true });
    const filters = req.filters as { shop_ids?: string[] };
    assert.deepEqual(filters.shop_ids, [...CURATED_SHOP_IDS]);
  });

  it("intersects caller shop_ids with the allowlist", () => {
    process.env.CATALOG_SHOP_ALLOWLIST = "true";
    const keep = CURATED_SHOP_IDS[0]!;
    const merged = applyCuratedShopAllowlist({
      shop_ids: [keep, "gid://shopify/Shop/999999999999"],
    });
    assert.deepEqual(merged.shop_ids, [keep]);
  });

  it("omits shop_ids when allowlist disabled", () => {
    delete process.env.CATALOG_SHOP_ALLOWLIST;
    const req = buildSearchCatalogRequest("navy blazer", { available: true });
    const filters = req.filters as { shop_ids?: string[] } | undefined;
    assert.equal(filters?.shop_ids, undefined);
  });
});
