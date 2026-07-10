import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyResolvedVariantToCard,
  resolveDisplayVariant,
  scoreVariantAgainstPreferred,
  variantMatchesPreferredOptions,
} from "./resolve-display-variant";
import type { CatalogVariantSummary } from "./catalog";
import type { CardWithVariantFields } from "./resolve-display-variant";

const shirtVariants: CatalogVariantSummary[] = [
  {
    id: "gid://shopify/ProductVariant/navy",
    price: { amount: 2500, currency: "USD" },
    options: [
      { name: "Color", label: "Navy" },
      { name: "Size", label: "M" },
    ],
  },
  {
    id: "gid://shopify/ProductVariant/black",
    price: { amount: 2800, currency: "USD" },
    options: [
      { name: "Color", label: "Black" },
      { name: "Size", label: "M" },
    ],
  },
];

describe("scoreVariantAgainstPreferred", () => {
  it("scores exact color match", () => {
    const score = scoreVariantAgainstPreferred(
      [{ name: "Color", label: "Black" }],
      [{ name: "Color", label: "Black" }],
    );
    assert.equal(score, 1);
  });
});

describe("resolveDisplayVariant", () => {
  it("picks black variant for black shirt query preferences", () => {
    const result = resolveDisplayVariant(shirtVariants, [
      { name: "Color", label: "Black" },
    ]);
    assert.equal(result.featuredVariant?.id, "gid://shopify/ProductVariant/black");
    assert.equal(result.displayPrice?.amount, 2800);
    assert.equal(result.confident, true);
  });

  it("returns no variant when preferences do not match any offer", () => {
    const result = resolveDisplayVariant(shirtVariants, [
      { name: "Color", label: "Red" },
    ]);
    assert.equal(result.featuredVariant, undefined);
    assert.equal(result.displayPrice, undefined);
    assert.equal(result.confident, false);
  });

  it("uses first variant when no preferences", () => {
    const result = resolveDisplayVariant(shirtVariants, []);
    assert.equal(result.featuredVariant?.id, "gid://shopify/ProductVariant/navy");
    assert.equal(result.confident, true);
  });

  it("handles empty search variants", () => {
    const result = resolveDisplayVariant([], [{ name: "Color", label: "Black" }]);
    assert.equal(result.featuredVariant, undefined);
  });
});

describe("variantMatchesPreferredOptions", () => {
  it("requires all axes to match", () => {
    assert.equal(
      variantMatchesPreferredOptions(
        {
          id: "v1",
          options: [{ name: "Color", label: "Black" }],
        },
        [{ name: "Color", label: "Black" }],
      ),
      true,
    );
    assert.equal(
      variantMatchesPreferredOptions(
        {
          id: "v1",
          options: [{ name: "Color", label: "Navy" }],
        },
        [{ name: "Color", label: "Black" }],
      ),
      false,
    );
  });
});

describe("applyResolvedVariantToCard", () => {
  it("sets displayPrice and featuredVariant on card", () => {
    const card: CardWithVariantFields & { id: string } = {
      id: "gid://shopify/p/1",
      searchVariants: shirtVariants,
      preferredOptions: [{ name: "Color", label: "Black" }],
    };
    applyResolvedVariantToCard(card);
    assert.equal(card.featuredVariant?.id, "gid://shopify/ProductVariant/black");
    assert.equal(card.displayPrice?.amount, 2800);
  });
});
