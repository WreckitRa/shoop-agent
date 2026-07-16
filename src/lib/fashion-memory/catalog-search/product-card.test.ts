import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hydratedCandidateToProductCard,
  preferredOptionsFromHydratedCandidate,
} from "./product-card";
import type { HydratedCandidate } from "../hydration/types";

describe("hydratedCandidateToProductCard", () => {
  it("renders from slim metadata without raw catalog payload", () => {
    const candidate = {
      id: "gid://shopify/p/abc",
      upid: "gid://shopify/p/abc",
      matched_by: [0],
      matched_by_color_variant: false,
      title: "Linen blazer",
      variant_options: [],
      image_urls: ["https://cdn.example/blazer.jpg"],
      media_urls: ["https://cdn.example/blazer-hydrated.jpg"],
      final_price: { amount: 199, currency: "USD" },
      size_status: "unknown",
    } as HydratedCandidate;

    const card = hydratedCandidateToProductCard(candidate);
    assert.equal(card.id, candidate.id);
    assert.equal(card.title, candidate.title);
    assert.equal(card.imageUrl, candidate.media_urls[0]);
    assert.deepEqual(card.displayPrice, candidate.final_price);
  });

  it("preselects size and color on the card", () => {
    const candidate = {
      id: "gid://shopify/Product/shoe",
      upid: "gid://shopify/Product/shoe",
      matched_by: [0],
      matched_by_color_variant: true,
      title: "Leather sneaker",
      variant_options: [
        { name: "Color", value: "White" },
        { name: "Size", value: "11" },
      ],
      image_urls: ["https://cdn.example/shoe.jpg"],
      media_urls: ["https://cdn.example/shoe.jpg"],
      final_price: { amount: 12000, currency: "USD" },
      size_status: "confirmed",
      size_selection: {
        option_name: "Size",
        merchant_label: "11",
      },
      color_selection: {
        option_name: "Color",
        merchant_label: "White",
      },
      selected_variant_id: "gid://shopify/ProductVariant/99",
    } as HydratedCandidate;

    const card = hydratedCandidateToProductCard(candidate);
    assert.deepEqual(card.preferredOptions, [
      { name: "Size", label: "11" },
      { name: "Color", label: "White" },
    ]);
    assert.deepEqual(card.featuredVariant?.options, card.preferredOptions);
    assert.equal(card.featuredVariant?.id, "gid://shopify/ProductVariant/99");
  });

  it("prefers resolved_options from get_product over size/color fields", () => {
    const candidate = {
      id: "gid://shopify/Product/shirt",
      upid: "gid://shopify/Product/shirt",
      matched_by: [0],
      matched_by_color_variant: false,
      title: "Oxford shirt",
      variant_options: [],
      image_urls: [],
      media_urls: [],
      size_status: "confirmed",
      size_selection: {
        option_name: "Size",
        merchant_label: "M",
      },
      resolved_options: [
        { name: "Size", label: "Medium" },
        { name: "Color", label: "Navy" },
      ],
      selected_variant_id: "gid://shopify/ProductVariant/42",
    } as HydratedCandidate;

    const card = hydratedCandidateToProductCard(candidate);
    assert.deepEqual(card.preferredOptions, [
      { name: "Size", label: "Medium" },
      { name: "Color", label: "Navy" },
    ]);
    assert.equal(card.featuredVariant?.id, "gid://shopify/ProductVariant/42");
  });

  it("uses corrected color for curated picks", () => {
    const candidate = {
      id: "gid://shopify/p/shirt",
      upid: "gid://shopify/p/shirt",
      matched_by: [0],
      matched_by_color_variant: false,
      title: "Oxford shirt",
      variant_options: [{ name: "Color", value: "Sky Blue" }],
      image_urls: [],
      media_urls: [],
      size_status: "unknown",
      color_selection: {
        option_name: "Color",
        merchant_label: "Sky Blue",
      },
    } as HydratedCandidate;

    const preferred = preferredOptionsFromHydratedCandidate(candidate, {
      correctedColor: "light blue",
    });
    assert.deepEqual(preferred, [{ name: "Color", label: "light blue" }]);
  });
});
