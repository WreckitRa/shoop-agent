import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hydratedCandidateToProductCard } from "./product-card";
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
});
