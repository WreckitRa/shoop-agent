import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  availabilityFromSearchVariant,
  isCardAvailabilityPurchasable,
  isVariantStockPurchasable,
  productSearchSummaryInStock,
  resolvePurchasableVariant,
} from "./catalog";

describe("isVariantStockPurchasable", () => {
  it("rejects sold out variants even with checkout_url", () => {
    assert.equal(
      isVariantStockPurchasable({
        checkout_url: "https://shop.example/cart/1",
        availability: { available: false, status: "sold_out" },
      }),
      false,
    );
  });

  it("accepts explicit in_stock variants", () => {
    assert.equal(
      isVariantStockPurchasable({
        checkout_url: "https://shop.example/cart/1",
        availability: { available: true, status: "in_stock" },
      }),
      true,
    );
  });

  it("rejects checkout-only variants without stock signal", () => {
    assert.equal(
      isVariantStockPurchasable({
        checkout_url: "https://shop.example/cart/1",
      }),
      false,
    );
  });
});

describe("isCardAvailabilityPurchasable", () => {
  it("rejects unknown stock", () => {
    assert.equal(
      isCardAvailabilityPurchasable({
        status: "unknown",
        preferredMatched: null,
        purchasable: true,
        shippable: true,
      }),
      false,
    );
  });

  it("rejects relaxed size matches", () => {
    assert.equal(
      isCardAvailabilityPurchasable({
        status: "in_stock",
        preferredMatched: false,
        purchasable: true,
        shippable: true,
      }),
      false,
    );
  });
});

describe("productSearchSummaryInStock", () => {
  it("requires an in-stock offer variant", () => {
    assert.equal(
      productSearchSummaryInStock({
        id: "gid://shopify/Product/1",
        title: "Sneaker",
        variants: [
          {
            id: "v1",
            checkout_url: "https://shop.example/cart/1",
            availability: { available: false, status: "sold_out" },
          },
          {
            id: "v2",
            checkout_url: "https://shop.example/cart/2",
            availability: { available: true, status: "in_stock" },
          },
        ],
      }),
      true,
    );
    assert.equal(
      productSearchSummaryInStock({
        id: "gid://shopify/Product/2",
        title: "Sold out sneaker",
        variants: [
          {
            id: "v1",
            checkout_url: "https://shop.example/cart/1",
            availability: { available: false, status: "sold_out" },
          },
        ],
      }),
      false,
    );
  });
});

describe("resolvePurchasableVariant", () => {
  it("skips sold-out offers", () => {
    const variant = resolvePurchasableVariant({
      id: "gid://shopify/Product/1",
      title: "Sneaker",
      variants: [
        {
          id: "v1",
          checkout_url: "https://shop.example/cart/1",
          availability: { available: false, status: "sold_out" },
        },
        {
          id: "v2",
          checkout_url: "https://shop.example/cart/2",
          availability: { available: true, status: "in_stock" },
        },
      ],
    });
    assert.equal(variant?.id, "v2");
  });
});

describe("availabilityFromSearchVariant", () => {
  it("does not infer in_stock from checkout_url alone", () => {
    const availability = availabilityFromSearchVariant({
      id: "v1",
      checkout_url: "https://shop.example/cart/1",
    });
    assert.equal(availability?.status, "unknown");
    assert.equal(isCardAvailabilityPurchasable(availability), false);
  });
});
