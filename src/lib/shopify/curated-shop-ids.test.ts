import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCuratedShopAllowlist,
  buildSearchCatalogRequest,
  chunkShopIds,
  mergeCatalogProductPages,
} from "./catalog";
import { CURATED_SHOP_IDS, isCuratedShopAllowlistEnabled } from "./curated-shop-ids";

describe("curated shop allowlist", () => {
  const prevAllow = process.env.CATALOG_SHOP_ALLOWLIST;
  const prevChunk = process.env.CATALOG_SHOP_IDS_CHUNK_SIZE;

  afterEach(() => {
    if (prevAllow === undefined) delete process.env.CATALOG_SHOP_ALLOWLIST;
    else process.env.CATALOG_SHOP_ALLOWLIST = prevAllow;
    if (prevChunk === undefined) delete process.env.CATALOG_SHOP_IDS_CHUNK_SIZE;
    else process.env.CATALOG_SHOP_IDS_CHUNK_SIZE = prevChunk;
  });

  it("has harvested shop GIDs", () => {
    assert.ok(CURATED_SHOP_IDS.length > 100);
    assert.ok(
      CURATED_SHOP_IDS.every((id) => id.startsWith("gid://shopify/Shop/")),
    );
  });

  it("is enabled by default", () => {
    delete process.env.CATALOG_SHOP_ALLOWLIST;
    assert.equal(isCuratedShopAllowlistEnabled(), true);
  });

  it("can be disabled via env", () => {
    process.env.CATALOG_SHOP_ALLOWLIST = "0";
    assert.equal(isCuratedShopAllowlistEnabled(), false);
  });

  it("injects shop_ids into search_catalog requests when enabled", () => {
    delete process.env.CATALOG_SHOP_ALLOWLIST;
    const req = buildSearchCatalogRequest("navy blazer", { available: true });
    const filters = req.filters as { shop_ids?: string[] };
    assert.deepEqual(filters.shop_ids, [...CURATED_SHOP_IDS]);
  });

  it("intersects caller shop_ids with the allowlist", () => {
    delete process.env.CATALOG_SHOP_ALLOWLIST;
    const keep = CURATED_SHOP_IDS[0]!;
    const merged = applyCuratedShopAllowlist({
      shop_ids: [keep, "gid://shopify/Shop/999999999999"],
    });
    assert.deepEqual(merged.shop_ids, [keep]);
  });

  it("keeps empty intersection as empty shop_ids (never global)", () => {
    delete process.env.CATALOG_SHOP_ALLOWLIST;
    const merged = applyCuratedShopAllowlist({
      shop_ids: ["gid://shopify/Shop/999999999999"],
    });
    assert.deepEqual(merged.shop_ids, []);
  });

  it("omits shop_ids when allowlist disabled", () => {
    process.env.CATALOG_SHOP_ALLOWLIST = "false";
    const req = buildSearchCatalogRequest("navy blazer", { available: true });
    const filters = req.filters as { shop_ids?: string[] } | undefined;
    assert.equal(filters?.shop_ids, undefined);
  });

  it("chunks shop_ids for oversized allowlists", () => {
    const chunks = chunkShopIds(CURATED_SHOP_IDS, 100);
    assert.ok(chunks.length >= 2);
    assert.ok(chunks.every((c) => c.length <= 100));
    assert.equal(
      chunks.reduce((n, c) => n + c.length, 0),
      CURATED_SHOP_IDS.length,
    );
  });

  it("mergeCatalogProductPages round-robins and dedupes", () => {
    const merged = mergeCatalogProductPages([
      [
        { id: "a", title: "A1" },
        { id: "b", title: "B1" },
      ],
      [
        { id: "a", title: "A2" },
        { id: "c", title: "C1" },
      ],
    ]);
    assert.deepEqual(
      merged.map((p) => p.id),
      ["a", "b", "c"],
    );
  });
});
