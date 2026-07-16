import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { FashionSearchBrief } from "../router/types";
import { buildColorSelection } from "./build-color-selection";

const brief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "single_item",
  garments: ["shoes"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "casual",
  color_direction: { source: "stated", stated_colors: ["white"] },
};

function product(
  overrides: Partial<FashionSlotCatalogProduct> = {},
): FashionSlotCatalogProduct {
  return {
    id: "gid://shopify/p/shoe",
    upid: "gid://shopify/p/shoe",
    matched_by: [0],
    matched_by_color_variant: false,
    title: "Leather sneaker",
    variant_options: overrides.variant_options ?? [],
    image_urls: [],
    raw: { id: "gid://shopify/p/shoe", title: "Leather sneaker" } as CatalogProductSummary,
    ...overrides,
  };
}

describe("buildColorSelection", () => {
  it("matches stated color to merchant label", () => {
    const selection = buildColorSelection({
      product: product({
        variant_options: [
          { name: "Color", value: "White" },
          { name: "Color", value: "Black" },
          { name: "Size", value: "11" },
        ],
      }),
      garment: "shoes",
      brief,
    });

    assert.deepEqual(selection, {
      option_name: "Color",
      merchant_label: "White",
    });
  });

  it("uses primary variant color when matched by color query", () => {
    const selection = buildColorSelection({
      product: product({
        matched_by_color_variant: true,
        raw: {
          id: "gid://shopify/p/shoe",
          title: "Leather sneaker",
          variants: [
            {
              id: "v1",
              checkout_url: "https://shop.example/checkout",
              options: [
                { name: "Color", label: "Off White" },
                { name: "Size", label: "11" },
              ],
            },
          ],
        } as CatalogProductSummary,
      }),
      garment: "shoes",
      brief: { ...brief, color_direction: { source: "none" } },
    });

    assert.deepEqual(selection, {
      option_name: "Color",
      merchant_label: "Off White",
    });
  });
});
