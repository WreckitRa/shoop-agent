import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { productCurationJobPayloadSchema } from "./job-payload";

describe("productCurationJobPayloadSchema", () => {
  it("accepts null shoppingModeMeta.contextTag", () => {
    const parsed = productCurationJobPayloadSchema.safeParse({
      searchInput: { query: "black shirt men" },
      cards: [{ id: "gid://shopify/p/1", title: "Shirt" }],
      displayLimit: 5,
      memoryQueryHint: "shirts",
      shoppingModeMeta: {
        version: 1,
        mode: "judge",
        source: "auto",
        contextTag: null,
      },
    });
    assert.equal(parsed.success, true);
  });
});
