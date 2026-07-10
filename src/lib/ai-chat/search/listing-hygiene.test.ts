import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeListingHygiene,
  formatListingHygieneLine,
  hasEstablishedMerchant,
  hasSkuTitle,
  isDeterministicListingJunk,
} from "./listing-hygiene";
import { classifyBrandTier } from "./brand-anchors";
import type { CatalogProductDetail } from "@/lib/shopify/catalog";
import type { SearchBrief } from "./types";

const brief: SearchBrief = {
  archetype: "specific",
  query: "black men's wool blazer",
  category: "blazer",
  mustHaves: ["black"],
  niceToHaves: [],
  budget: { amountCents: 25000, type: "soft", currency: "USD" },
  variantConstraints: {},
  genderScope: "mens",
  recipient: { kind: "self" },
  rankingProfile: "relevance_first",
};

const blazerBrief: SearchBrief = {
  ...brief,
  query: "men's black work blazer classic regular fit business formal suit jacket",
};

function detail(partial: Partial<CatalogProductDetail>): CatalogProductDetail {
  return {
    id: "gid://shopify/Product/1",
    title: "Test Product",
    variants: [{ id: "v1", price: { amount: 2700, currency: "USD" } }],
    ...partial,
  } as CatalogProductDetail;
}

const flexProDetail = detail({
  id: "gid://shopify/p/5zWydvVWLSUK8oKtzsr8M2",
  title: "FlexPro Suit Jacket Black",
  rating: { value: 4.8, count: 20, scaleMax: 5 },
  options: [
    {
      name: "Color",
      values: [{ label: "Black" }, { label: "Gray" }, { label: "Navy" }],
    },
    {
      name: "Size",
      values: [{ label: "38" }, { label: "40" }, { label: "42" }, { label: "44" }],
    },
  ],
  seller: {
    name: "Under 5'10",
    domain: "bantam-bloke.myshopify.com",
    url: "https://www.under510.com",
  },
  variants: [
    {
      id: "v1",
      price: { amount: 2500, currency: "USD" },
      seller: {
        name: "Under 5'10",
        domain: "bantam-bloke.myshopify.com",
      },
    },
  ],
});

describe("listing hygiene", () => {
  it("flags size-in-title clearance pattern", () => {
    const h = analyzeListingHygiene(
      detail({ title: "Mens Blazer 46 L Wool Blend 70290625M" }),
      brief,
      2700,
    );
    assert.ok(h.flags.includes("single_size_clearance"));
    assert.ok(h.flags.includes("sku_title"));
  });

  it("flags thin perfect ratings", () => {
    const h = analyzeListingHygiene(
      detail({
        title: "No Name Blazer",
        rating: { value: 5, count: 25, scaleMax: 5 },
      }),
      brief,
      9900,
    );
    assert.ok(h.flags.includes("thin_reviews"));
  });

  it("marks suspiciously cheap wool blazer as price anomaly + junk", () => {
    const h = analyzeListingHygiene(
      detail({ title: "70290625M Wool Blazer Black" }),
      brief,
      2700,
    );
    assert.ok(h.flags.includes("price_anomaly"));
    assert.equal(h.quality, "junk");
    assert.equal(isDeterministicListingJunk(h), true);
  });

  it("does not treat product-line titles as SKU blobs", () => {
    assert.equal(hasSkuTitle("FlexPro Suit Jacket Black"), false);
    assert.equal(hasSkuTitle("70290625M Wool Blazer Black"), true);
  });

  it("FlexPro from established merchant is suspect not junk despite low search price", () => {
    assert.equal(hasEstablishedMerchant(flexProDetail), true);
    const h = analyzeListingHygiene(flexProDetail, blazerBrief, 2500);
    assert.equal(h.flags.includes("sku_title"), false);
    assert.equal(h.flags.includes("dropship_tell"), false);
    assert.ok(h.flags.includes("price_anomaly"));
    assert.equal(h.quality, "suspect");
    assert.equal(isDeterministicListingJunk(h), false);
    assert.equal(h.merchantEstablished, true);
  });

  it("classifies Calvin Klein as anchor", () => {
    const tier = classifyBrandTier(
      { id: "1", title: "Calvin Klein Men's Slim Blazer" } as CatalogProductDetail,
      brief.query,
      brief.category,
    );
    assert.equal(tier, "anchor");
  });

  it("formats hygiene line for prompts", () => {
    const h = analyzeListingHygiene(detail({ title: "Theory Wool Blazer" }), brief, 19900);
    const line = formatListingHygieneLine(h);
    assert.match(line, /listing: clean|suspect/);
    assert.match(line, /brand: anchor/);
  });
});
