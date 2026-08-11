import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buyablesFromInputRefs,
  parseCatalogRef,
} from "./moodboard-context";

describe("moodboard catalog refs", () => {
  it("parses shopify gid catalog refs", () => {
    assert.deepEqual(
      parseCatalogRef("catalog:gid://shopify/Product/123:var-9"),
      {
        productId: "gid://shopify/Product/123",
        variantId: "var-9",
      },
    );
  });

  it("reads buyables + catalog refs from inputRefs", () => {
    const buyables = buyablesFromInputRefs({
      buyables: [
        {
          productId: "gid://shopify/Product/1",
          title: "Blazer",
        },
      ],
      refs: ["catalog:gid://shopify/Product/2"],
      product_id: "gid://shopify/Product/1",
    });
    assert.equal(buyables.length, 2);
    assert.equal(buyables[0]?.productId, "gid://shopify/Product/1");
    assert.equal(buyables[1]?.productId, "gid://shopify/Product/2");
  });
});
