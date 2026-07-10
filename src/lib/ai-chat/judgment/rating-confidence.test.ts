import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampTierConfidenceFromRating } from "../judgment/rating-confidence";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";

const product = (count: number, value: number) =>
  ({
    id: "gid://x/1",
    title: "Test",
    rating: { value, count, scaleMax: 5 },
  }) as unknown as CatalogProductSummary;

describe("rating-confidence", () => {
  it("downgrades strong confidence on small-n perfect ratings", () => {
    const clamped = clampTierConfidenceFromRating(product(25, 5), "strong");
    assert.equal(clamped, "moderate");
  });

  it("limits confidence when review count is tiny", () => {
    const clamped = clampTierConfidenceFromRating(product(3, 5), "strong");
    assert.equal(clamped, "limited");
  });
});
