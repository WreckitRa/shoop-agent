import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { validatePickReason } from "./reason-validation";

describe("extractCatalogAttributes", () => {
  it("reads metadata.attributes arrays", () => {
    const attrs = extractCatalogAttributes({
      title: "Boot",
      metadata: {
        attributes: [
          { name: "Material", value: "leather" },
          { name: "Style", value: "streetwear" },
        ],
      },
    });
    assert.deepEqual(attrs, [
      { name: "Material", value: "leather" },
      { name: "Style", value: "streetwear" },
    ]);
  });
});

describe("validatePickReason", () => {
  const ctx = {
    title: "Matte Black Lug Sole Ankle Boot",
    attributes: [
      { name: "Material", value: "matte leather" },
      { name: "Style", value: "streetwear" },
    ],
    slot: "shoop_pick" as const,
    tier: 1,
  };

  it("flags generic rank reasons", () => {
    const result = validatePickReason("Top-ranked match for your query.", ctx);
    assert.equal(result.ok, false);
    assert.equal(result.violation, "generic_rank_reason");
  });

  it("accepts feature-citing tier-1 reasons", () => {
    const result = validatePickReason(
      "Matte black leather, chunky lugged sole — reads street.",
      ctx,
    );
    assert.equal(result.ok, true);
  });

  it("flags tier-1 reasons with no product features", () => {
    const result = validatePickReason(
      "A sensible choice for everyday wear.",
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal(result.violation, "tier1_no_product_features");
  });
});
