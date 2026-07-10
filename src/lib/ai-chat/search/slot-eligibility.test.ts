import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { curatedVerifiedFromPlacements } from "./slot-eligibility";
import type { VerifiedCandidate } from "./verify";

function vc(id: string, upid: string, value: number, reviews: number): VerifiedCandidate {
  return {
    upid,
    detail: {
      id,
      title: `Product ${id}`,
      rating: { value: 4.5, count: reviews, scaleMax: 5 },
      variants: [{ id: "v1", price: { amount: 5000, currency: "USD" } }],
    },
    resolvedPriceCents: 5000,
    score: value,
    breakdown: { value, gem: 0, relPrior: 0, quality: 0, popularity: 0, fit: 0, penalties: 0, constraintPenalty: 0, total: value },
    heroEligible: true,
    sellerDomain: null,
    product: { id, title: `Product ${id}` },
    sources: [],
    bestRank: 1,
    corroboration: 1,
    fromDiscovery: false,
    availability: { status: "in_stock" },
    nativeCheckoutUrl: "https://example.com",
    resolvedOptions: [],
    exactMatch: true,
  } as VerifiedCandidate;
}

describe("curatedVerifiedFromPlacements", () => {
  it("returns only judge-placed candidates in placement order", () => {
    const pool = [
      vc("gid://shopify/Product/early-cheap", "u1", 0.99, 5000),
      vc("gid://shopify/Product/curated-a", "u2", 0.6, 120),
      vc("gid://shopify/Product/curated-b", "u3", 0.8, 40),
    ];
    const placements = [
      { productId: "gid://shopify/Product/curated-b" },
      { productId: "gid://shopify/Product/curated-a" },
    ];
    const curated = curatedVerifiedFromPlacements(pool, placements, (p, id) =>
      p.find((c) => c.detail.id === id),
    );
    assert.equal(curated.length, 2);
    assert.equal(curated[0]!.detail.id, "gid://shopify/Product/curated-b");
    assert.equal(curated[1]!.detail.id, "gid://shopify/Product/curated-a");
    assert.ok(!curated.some((c) => c.detail.id === "gid://shopify/Product/early-cheap"));
  });
});
