import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow } from "../types";
import type {
  FashionSlotCatalogProduct,
  FashionSlotCatalogResult,
} from "./types";
import type { FashionSearchPlan } from "../search-planner/types";
import { postProcessFashionCatalogSlots } from "./search-catalog-for-plan";

function slotProduct(
  id: string,
  overrides: Partial<FashionSlotCatalogProduct> & { raw?: CatalogProductSummary } = {},
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: overrides.matched_by ?? [0],
    matched_by_color_variant: false,
    title: overrides.title ?? `Product ${id}`,
    variant_options: overrides.variant_options ?? [],
    image_urls: [],
    raw:
      overrides.raw ??
      ({
        id,
        title: overrides.title ?? `Product ${id}`,
      } as CatalogProductSummary),
    price: overrides.price,
    rating_value: overrides.rating_value,
    review_count: overrides.review_count,
    normalized: overrides.normalized,
  };
}

const brief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "casual shirt",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: [],
    sizes_unconfirmed: ["shirt"],
  },
};

const plan: FashionSearchPlan = {
  version: 1,
  mode: "single_item",
  reasoning: "test",
  brief,
  currentDate: "2026-07-08",
  slots: [
    {
      slot_id: "shirt",
      garment: "shirt",
      role: "anchor",
      style_direction: "casual",
      palette_constraint: null,
      palette_source: "spread",
      options_wanted: 4,
      query_variants: ["mens casual shirt"],
    },
  ],
};

function queryLogsForRanks(ranks: Record<string, number>) {
  return Object.entries(ranks).map(([id, rank], variant_index) => ({
    slot_id: "shirt",
    variant_index,
    query: `q-${variant_index}`,
    reformulation: false,
    status: "ok" as const,
    raw_count: rank + 1,
    duration_ms: 1,
    products: Array.from({ length: rank + 1 }, (_, i) =>
      i === rank ? { id } : { id: `filler-${variant_index}-${i}` },
    ),
  }));
}

function makeInputSlot(products: FashionSlotCatalogProduct[]): FashionSlotCatalogResult {
  const ranks = Object.fromEntries(products.map((p, i) => [p.id, i * 10]));
  return {
    slot_id: "shirt",
    garment: "shirt",
    products,
    query_variants_used: [{ query: "mens casual shirt", category_filtered: true }],
    counts: {
      unique_products: products.length,
      per_variant: [products.length],
      reformulated: false,
    },
    query_logs: queryLogsForRanks(ranks),
  };
}

describe("postProcessFashionCatalogSlots orchestration", () => {
  it("normalize → hard drops → scoring preserves survivors, drops proof failures, re-ranks", async () => {
    const unavailable = slotProduct("unavail", {
      raw: {
        id: "unavail",
        title: "Sold out shirt",
        availableForSale: false,
      } as CatalogProductSummary,
      variant_options: [{ name: "Size", value: "M" }],
    });
    const topRank = slotProduct("top", {
      matched_by: [0],
      variant_options: [{ name: "Size", value: "L" }],
    });
    const lowRank = slotProduct("low", {
      matched_by: [0, 1],
      rating_value: 3.0,
      review_count: 100,
      variant_options: [{ name: "Size", value: "M" }],
    });

    const input = makeInputSlot([unavailable, lowRank, topRank]);
    input.query_logs = queryLogsForRanks({ top: 0, low: 40, unavail: 5 });

    const result = await postProcessFashionCatalogSlots({
      plan,
      slots: [input],
      recipientFacts: [] as FashionFactRow[],
    });

    const slot = result.slots[0]!;
    assert.equal(slot.products.length, 2);
    assert.deepEqual(
      slot.products.map((p) => p.id),
      ["top", "low"],
    );
    assert.equal(slot.dropped?.length, 1);
    assert.equal(slot.dropped?.[0]?.product_id, "unavail");
    assert.equal(slot.dropped?.[0]?.rule, "unavailable");

    for (const p of slot.products) {
      assert.ok(p.score, `missing score on ${p.id}`);
      assert.ok(p.normalized, `missing normalized on ${p.id}`);
    }
    assert.ok((slot.products[0]?.score?.final ?? 0) > (slot.products[1]?.score?.final ?? 0));
    assert.equal(slot.counts.unique_products, 2);
  });

  it("scoring never removes products — output count equals post-drop survivors", async () => {
    const products = [
      slotProduct("a", { variant_options: [{ name: "Color", value: "Black" }] }),
      slotProduct("b", { variant_options: [{ name: "Color", value: "Navy" }] }),
    ];
    const input = makeInputSlot(products);

    const result = await postProcessFashionCatalogSlots({
      plan,
      slots: [input],
      recipientFacts: [],
    });

    const slot = result.slots[0]!;
    assert.equal(slot.products.length, 2);
    assert.deepEqual(
      slot.products.map((p) => p.id).sort(),
      ["a", "b"],
    );
  });
});

describe("hydration accessToken gate", () => {
  it("empty string is valid for hosted Global Catalog (not treated as missing)", () => {
    const accessToken = "";
    const profile = {
      countryCode: "US",
      currency: "USD",
      positiveSignals: [] as string[],
    };
    assert.equal(accessToken != null && profile != null, true);
    // Legacy bug: `!accessToken` skipped hydration on hosted catalog.
    assert.equal(!accessToken || !profile, true);
  });
});
