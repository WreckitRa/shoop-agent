import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import {
  extractProductTasteAttributes,
  tasteFitForHeroes,
  tasteFitForProduct,
} from "./taste-fit";

function product(
  id: string,
  opts: {
    title: string;
    colors?: string[];
    rawAttrs?: Array<{ name: string; value: string }>;
    shop_domain?: string;
  },
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: opts.title,
    variant_options: [],
    image_urls: [],
    shop_domain: opts.shop_domain,
    raw: {
      id,
      title: opts.title,
      metadata: opts.rawAttrs
        ? { attributes: opts.rawAttrs }
        : undefined,
    } as CatalogProductSummary,
    normalized: opts.colors
      ? {
          colors: { buckets: opts.colors as never[], status: "resolved" },
          sizes: [],
        }
      : undefined,
  };
}

describe("taste-fit metric", () => {
  it("matches liked navy and skips unknown silhouette", () => {
    const p = product("navy-blazer", {
      title: "Navy tailored blazer",
      colors: ["navy"],
    });
    const r = tasteFitForProduct(p, [
      { signal_type: "color", value: "navy", polarity: 1 },
      { signal_type: "silhouette", value: "tailored", polarity: 1 },
    ]);
    assert.equal(r.considered, 2);
    assert.equal(r.matched, 2);
    assert.equal(r.taste_fit, 1);
  });

  it("contradicts liked navy when the product is red", () => {
    const p = product("red-blazer", {
      title: "Red party blazer",
      colors: ["red"],
    });
    const r = tasteFitForProduct(p, [
      { signal_type: "color", value: "navy", polarity: 1 },
    ]);
    assert.equal(r.taste_fit, -1);
    assert.equal(r.contradicted, 1);
  });

  it("does not score unknown color (never penalize unknown)", () => {
    const p = product("plain", { title: "Wool coat" });
    const r = tasteFitForProduct(p, [
      { signal_type: "color", value: "camel", polarity: 1 },
    ]);
    assert.equal(r.taste_fit, null);
    assert.equal(r.considered, 0);
  });

  it("dislike of logos: product with logo contradicts; solid matches", () => {
    const logo = product("logo-tee", { title: "Graphic logo tee" });
    const solid = product("plain-tee", {
      title: "Solid crew tee",
      rawAttrs: [{ name: "pattern", value: "solid" }],
    });
    const signals = [
      { signal_type: "pattern" as const, value: "logo", polarity: -1 },
    ];
    assert.equal(tasteFitForProduct(logo, signals).taste_fit, -1);
    assert.equal(tasteFitForProduct(solid, signals).taste_fit, 1);
  });

  it("does not treat 'tired' as the color red", () => {
    const p = product("x", { title: "Tired of basic coats" });
    const attrs = extractProductTasteAttributes(p);
    assert.equal(attrs.color.includes("red"), false);
  });

  it("mean of heroes with mixed fits", () => {
    const navy = product("a", { title: "Navy blazer", colors: ["navy"] });
    const red = product("b", { title: "Red blazer", colors: ["red"] });
    const out = tasteFitForHeroes({
      preference_anchor: "keep",
      signals: [{ signal_type: "color", value: "navy", polarity: 1 }],
      heroes: [
        { product_id: "a", slot_id: "s1", product: navy },
        { product_id: "b", slot_id: "s1", product: red },
      ],
    });
    assert.equal(out.mean, 0);
    assert.equal(out.preference_anchor, "keep");
  });
});
