import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cartNudgeCopy } from "./CartButton";
import type { ActiveCartState } from "@/lib/cart/types";

function cartWithPrice(
  priceAtAddCents: number | null,
  priceCents: number,
): ActiveCartState {
  return {
    hasCart: true,
    groups: [],
    totalQuantity: 1,
    groupCount: 1,
    cartId: "cart-1",
    checkoutUrl: null,
    shopDomain: "shop.example",
    continueUrl: null,
    currency: "USD",
    totalCents: priceCents,
    lineItems: [
      {
        variantId: "variant-1",
        quantity: 1,
        title: "Italian Wool Blazer",
        imageUrl: null,
        priceCents,
        priceAtAddCents,
        lineTotalCents: priceCents,
        currency: "USD",
        sellerName: null,
        sellerDomain: "shop.example",
        productId: null,
        productUrl: null,
      },
    ],
    messages: [],
    expiresAt: null,
    lastSyncedAt: null,
  };
}

describe("cartNudgeCopy", () => {
  it("speaks about a verified price drop", () => {
    assert.match(
      cartNudgeCopy(cartWithPrice(20_000, 18_600)),
      /^Your blazer’s still here… and it dropped \$14\.$/,
    );
  });

  it("does not claim a drop without a lower live price", () => {
    assert.equal(
      cartNudgeCopy(cartWithPrice(null, 18_600)),
      "Your blazer’s still here… ready when you are.",
    );
    assert.equal(
      cartNudgeCopy(cartWithPrice(18_600, 18_600)),
      "Your blazer’s still here… ready when you are.",
    );
  });
});
