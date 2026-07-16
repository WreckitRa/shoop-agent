import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow } from "../types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { taxonomyCategoriesForGarment } from "../catalog-search/garment-taxonomy";
import { applyHardDrops } from "./apply-hard-drops";
import { resetFxCacheForTests, seedFxRatesForTests } from "@/lib/money/fx";

function fact<T extends FashionFactRow["fact_type"]>(
  fact_type: T,
  value: FashionFactRow["value"],
  garment_type: string | null = null,
): FashionFactRow {
  return {
    id: `fact-${fact_type}-${String(value)}`,
    user_id: "u1",
    person_id: "p1",
    fact_type,
    garment_type,
    value,
    source_quote: null,
    status: "active",
    superseded_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as FashionFactRow;
}

function product(
  id: string,
  overrides: Partial<FashionSlotCatalogProduct> & { raw?: CatalogProductSummary } = {},
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: overrides.title ?? "Test Product",
    variant_options: overrides.variant_options ?? [],
    image_urls: [],
    raw: overrides.raw ?? ({ id, title: overrides.title ?? "Test Product" } as CatalogProductSummary),
    normalized: overrides.normalized,
    price: overrides.price,
    taxonomy_category: overrides.taxonomy_category,
  };
}

const briefWithSizes: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "shirt",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [],
  },
};

const briefSizesUnknown: FashionSearchBrief = {
  ...briefWithSizes,
  knowledge_state: {
    department: "mens",
    sizes_confirmed: [],
    sizes_unconfirmed: ["shirt"],
  },
};

describe("applyHardDrops material", () => {
  it("100% Polyester Track Jacket drops when polyester banned", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "jacket" },
      products: [product("p1", { title: "100% Polyester Track Jacket" })],
      recipientFacts: [fact("no_go", { kind: "material", value: "polyester" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 0);
    assert.equal(result.dropped[0]?.rule, "material_no_go");
  });

  it("Non-polyester performance tee survives", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "tee" },
      products: [product("p1", { title: "Non-polyester performance tee" })],
      recipientFacts: [fact("no_go", { kind: "material", value: "polyester" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
  });

  it("Cotton shirt (5% elastane) suspicion only when elastane banned", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [product("p1", { title: "Cotton shirt (5% elastane)" })],
      recipientFacts: [fact("no_go", { kind: "material", value: "elastane" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
    assert.ok(
      result.survivors[0]?.suspicions.some((s) =>
        s.rule.startsWith("material_suspected:elastane"),
      ),
    );
  });

  it("60% cotton 40% polyester drops when polyester banned", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [product("p1", { title: "60% cotton 40% polyester" })],
      recipientFacts: [fact("no_go", { kind: "material", value: "polyester" })],
      brief: briefWithSizes,
    });
    assert.equal(result.dropped.length, 1);
  });

  it("Vegan leather jacket survives when leather banned", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "jacket" },
      products: [product("p1", { title: "Vegan leather jacket" })],
      recipientFacts: [fact("no_go", { kind: "material", value: "leather" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
  });

  it("Genuine leather belt in title drops when leather banned", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "belt" },
      products: [product("p1", { title: "Genuine leather belt" })],
      recipientFacts: [fact("no_go", { kind: "material", value: "leather" })],
      brief: briefWithSizes,
    });
    assert.equal(result.dropped[0]?.rule, "material_no_go");
  });

  it("Leather trim available in description is suspicion only", () => {
    const raw = {
      id: "p1",
      title: "Wool coat",
      description: { text: "Leather trim available on cuffs" },
    } as unknown as CatalogProductSummary;
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "coat" },
      products: [product("p1", { title: "Wool coat", raw })],
      recipientFacts: [fact("no_go", { kind: "material", value: "leather" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
    assert.ok(
      result.survivors[0]?.suspicions.some((s) =>
        s.rule.startsWith("material_suspected:leather"),
      ),
    );
  });

  it("Laine mérinos drops when wool banned", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "sweater" },
      products: [product("p1", { title: "Laine mérinos" })],
      recipientFacts: [fact("no_go", { kind: "material", value: "wool" })],
      brief: briefWithSizes,
    });
    assert.equal(result.dropped.length, 1);
  });
});

describe("applyHardDrops garment taxonomy", () => {
  it("shorts banned + Shorts taxonomy drops; short-sleeve shirt title untouched", () => {
    const shortsGid = taxonomyCategoriesForGarment("shorts")[0]!;
    const shirtGid = taxonomyCategoriesForGarment("shirt")[0]!;

    const shortsProduct = product("shorts", {
      title: "Summer shorts",
      taxonomy_category: shortsGid,
    });
    const shirtProduct = product("shirt", {
      title: "short-sleeve shirt",
      taxonomy_category: shirtGid,
    });

    const facts = [fact("no_go", { kind: "garment", value: "shorts" })];
    const shortsResult = applyHardDrops({
      slot: { slot_id: "s1", garment: "shorts" },
      products: [shortsProduct],
      recipientFacts: facts,
      brief: briefWithSizes,
    });
    const shirtResult = applyHardDrops({
      slot: { slot_id: "s2", garment: "shirt" },
      products: [shirtProduct],
      recipientFacts: facts,
      brief: briefWithSizes,
    });

    assert.equal(shortsResult.dropped[0]?.rule, "garment_no_go");
    assert.equal(shirtResult.survivors.length, 1);
    assert.equal(shirtResult.dropped.length, 0);
  });
});

describe("applyHardDrops size", () => {
  const sizeM = fact("size", { system: "alpha", value: "M" }, "tops");

  it("resolved [S, XL] drops for user M", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          normalized: {
            colors: { buckets: [], status: "unknown" },
            sizes: [
              { raw: "S", size: { alpha: "S" }, status: "resolved" },
              { raw: "XL", size: { alpha: "XL" }, status: "resolved" },
            ],
          },
        }),
      ],
      recipientFacts: [sizeM],
      brief: briefWithSizes,
    });
    assert.equal(result.dropped[0]?.rule, "size_mismatch");
  });

  it("resolved [38 ambiguous] survives flagged size_system_unverified", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          normalized: {
            colors: { buckets: [], status: "unknown" },
            sizes: [
              {
                raw: "38",
                size: { numeric: 38, numeric_system: "ambiguous" },
                status: "resolved",
              },
            ],
          },
        }),
      ],
      recipientFacts: [fact("size", { system: "eu", value: 38 }, "tops")],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
    assert.ok(
      result.survivors[0]?.suspicions.some((s) => s.rule === "size_system_unverified"),
    );
  });

  it("unknown size label survives flagged size_unknown", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          normalized: {
            colors: { buckets: [], status: "unknown" },
            sizes: [{ raw: "Taille 2", size: null, status: "unknown" }],
          },
        }),
      ],
      recipientFacts: [sizeM],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
    assert.ok(result.survivors[0]?.suspicions.some((s) => s.rule === "size_unknown"));
  });

  it("user size unknown skips size check entirely", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          normalized: {
            colors: { buckets: [], status: "unknown" },
            sizes: [
              { raw: "S", size: { alpha: "S" }, status: "resolved" },
              { raw: "XL", size: { alpha: "XL" }, status: "resolved" },
            ],
          },
        }),
      ],
      recipientFacts: [sizeM],
      brief: briefSizesUnknown,
    });
    assert.equal(result.survivors.length, 1);
    assert.equal(
      result.survivors[0]?.suspicions.filter((s) => s.rule.startsWith("size")).length,
      0,
    );
  });
});

describe("applyHardDrops color", () => {
  it("red banned + resolved [red] drops", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          normalized: {
            colors: { buckets: ["red"], status: "resolved" },
            sizes: [],
          },
        }),
      ],
      recipientFacts: [fact("no_go", { kind: "color", value: "red" })],
      brief: briefWithSizes,
    });
    assert.equal(result.dropped[0]?.rule, "color_no_go");
  });

  it("red banned + resolved [red, white] survives with suspicion", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          normalized: {
            colors: { buckets: ["red", "white"], status: "resolved" },
            sizes: [],
          },
        }),
      ],
      recipientFacts: [fact("no_go", { kind: "color", value: "red" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
    assert.ok(result.survivors[0]?.suspicions.some((s) => s.rule === "color_two_tone"));
  });

  it("unknown color untouched", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          title: "Mens Oxford Shirt",
          normalized: {
            colors: { buckets: ["unknown"], status: "unknown" },
            sizes: [],
          },
        }),
      ],
      recipientFacts: [fact("no_go", { kind: "color", value: "red" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
    assert.equal(result.dropped.length, 0);
    // Confirmed mens title → no department_unknown; color unknown → no color flags
    assert.equal(result.survivors[0]?.suspicions.length, 0);
  });
});

describe("applyHardDrops availability and budget", () => {
  it("availableForSale false drops", () => {
    const raw = { id: "p1", title: "X", availableForSale: false } as CatalogProductSummary;
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [product("p1", { raw })],
      recipientFacts: [],
      brief: briefWithSizes,
    });
    assert.equal(result.dropped[0]?.rule, "unavailable");
  });

  it("budget stated drops above padded max", () => {
    const brief: FashionSearchBrief = {
      ...briefWithSizes,
      budget_context: { stated: true, max: 100, currency: "USD" },
    };
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [product("p1", { price: { amount: 13000, currency: "USD" } })],
      recipientFacts: [],
      brief,
    });
    assert.equal(result.dropped[0]?.rule, "budget");
  });

  it("converts foreign currency for budget compare instead of dropping", () => {
    resetFxCacheForTests();
    seedFxRatesForTests("INR", { USD: 0.012 });
    const brief: FashionSearchBrief = {
      ...briefWithSizes,
      budget_context: { stated: true, max: 100, currency: "USD" },
    };
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("inr", {
          title: "Mens Casual Shirt",
          price: { amount: 94900, currency: "INR" },
        }),
        product("usd", {
          title: "Mens Casual Shirt",
          price: { amount: 4500, currency: "USD" },
        }),
      ],
      recipientFacts: [],
      brief,
      profileCurrency: "USD",
    });
    assert.equal(result.dropped.some((d) => d.rule === "currency_mismatch"), false);
    assert.equal(result.survivors.some((s) => s.id === "usd"), true);
    assert.equal(result.survivors.some((s) => s.id === "inr"), true);
  });

  it("missing price flags no_price", () => {
    const brief: FashionSearchBrief = {
      ...briefWithSizes,
      budget_context: { stated: true, max: 100, currency: "USD" },
    };
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [product("p1")],
      recipientFacts: [],
      brief,
    });
    assert.equal(result.survivors.length, 1);
    assert.ok(result.survivors[0]?.suspicions.some((s) => s.rule === "no_price"));
  });
});

describe("applyHardDrops style no-gos", () => {
  it("compiles style no-gos into curator_exclusions without dropping", () => {
    const result = applyHardDrops({
      slot: { slot_id: "s1", garment: "shirt" },
      products: [
        product("p1", {
          title: "Loud logo tee",
          normalized: {
            colors: { buckets: ["print"], status: "resolved" },
            sizes: [],
          },
        }),
      ],
      recipientFacts: [fact("no_go", { kind: "style", value: "big logos" })],
      brief: briefWithSizes,
    });
    assert.equal(result.survivors.length, 1);
    assert.deepEqual(result.curator_exclusions, ["big logos"]);
    assert.ok(result.survivors[0]?.suspicions.some((s) => s.rule === "pattern_suspected"));
  });
});
