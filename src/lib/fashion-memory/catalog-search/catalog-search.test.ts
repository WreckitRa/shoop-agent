import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSlotCatalogFilters } from "./slot-filters";
import { buildVariantFilterPlans } from "./category-hedge";
import { composeSlotIntentString, dedupeIntentParts } from "./slot-intent";
import {
  hasGarmentTaxonomyMapping,
  taxonomyCategoriesForGarment,
} from "./garment-taxonomy";
import { dedupeSlotCatalogHits } from "./dedupe";
import { buildReformulationQueryVariants } from "./reformulation";
import { fashionCatalogReadyToDisplay } from "./display-ready";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionSearchBrief } from "../router/types";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";

const sampleBrief: FashionSearchBrief = {
  recipient_person_id: "abcd",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "work_consultant",
  quantity_hint: "one",
  must_haves: ["linen"],
  nice_to_haves: ["premium cotton", "no visible branding"],
  budget_context: { stated: true, max: 100, min: 40, currency: "USD" },
  style_direction: "Minimal smart-casual office shirts.",
};

const sampleSlot: FashionSearchPlanSlot = {
  slot_id: "shirt",
  garment: "shirt",
  role: "anchor",
  style_direction: "slim minimalist oxford shirts",
  palette_constraint: "neutral monochrome palette",
  palette_source: "profile" as const,
  options_wanted: 4,
  query_variants: ["slim oxford shirt", "minimal cotton shirt"],
};

describe("garment taxonomy map", () => {
  it("maps confident garments to Shopify taxonomy GIDs", () => {
    const shirts = taxonomyCategoriesForGarment("shirt");
    assert.equal(shirts[0], "gid://shopify/TaxonomyCategory/aa-1-13-7");
    assert.equal(hasGarmentTaxonomyMapping("jeans"), true);
  });

  it("maps swimwear parent and construction leaves", () => {
    assert.equal(
      taxonomyCategoriesForGarment("swimsuit")[0],
      "gid://shopify/TaxonomyCategory/aa-1-20",
    );
    assert.equal(
      taxonomyCategoriesForGarment("bikini")[0],
      "gid://shopify/TaxonomyCategory/aa-1-20-6",
    );
    assert.equal(
      taxonomyCategoriesForGarment("one-piece swimsuit")[0],
      "gid://shopify/TaxonomyCategory/aa-1-20-22",
    );
  });

  it("omits category when garment is unknown", () => {
    assert.deepEqual(taxonomyCategoriesForGarment("mystery widget"), []);
    assert.equal(hasGarmentTaxonomyMapping("mystery widget"), false);
  });
});

describe("buildVariantFilterPlans", () => {
  const profile = { countryCode: "US", currency: "USD", positiveSignals: [] };

  it("omits category on Lane A only when garment maps to taxonomy (no budget → A+C)", () => {
    const plans = buildVariantFilterPlans({
      garment: "shirt",
      brief: { ...sampleBrief, budget_context: { stated: false } },
      profile,
      queries: ["slim oxford shirt", "minimal cotton shirt", "office shirt"],
    });
    assert.equal(plans.length, 3);
    assert.equal(plans[0]!.lane, "A");
    assert.equal(plans[0]!.category_filtered, false);
    assert.equal(plans[0]!.filters.categories, undefined);
    assert.equal(plans[1]!.lane, "C");
    assert.equal(plans[1]!.category_filtered, true);
    assert.ok(plans[1]!.filters.categories?.[0]?.includes("aa-1-13-7"));
    assert.equal(plans[2]!.lane, "C");
    assert.equal(plans[2]!.category_filtered, true);
    assert.equal(plans[0]!.filters.available, true);
    assert.equal(plans[0]!.filters.ships_to?.country, "US");
  });

  it("adds Lane B price scout when budget is stated (A/B/C)", () => {
    const plans = buildVariantFilterPlans({
      garment: "shoes",
      brief: sampleBrief,
      profile,
      queries: ["mens loafers", "mens dress shoes", "mens leather shoes"],
    });
    assert.equal(plans.length, 3);
    assert.equal(plans[0]!.lane, "A");
    assert.equal(plans[0]!.category_filtered, false);
    assert.ok(plans[0]!.filters.price);
    assert.equal(plans[1]!.lane, "B");
    assert.equal(plans[1]!.category_filtered, true);
    assert.equal(plans[1]!.filters.price, undefined);
    assert.ok(plans[1]!.filters.categories?.length);
    assert.equal(plans[2]!.lane, "C");
    assert.equal(plans[2]!.category_filtered, true);
    assert.ok(plans[2]!.filters.price);
  });

  it("collapses to two lanes when no budget (lane_collapse_no_budget)", () => {
    const plans = buildVariantFilterPlans({
      garment: "shoes",
      brief: { ...sampleBrief, budget_context: { stated: false } },
      profile,
      queries: ["mens loafers", "mens dress shoes"],
    });
    assert.equal(plans.length, 2);
    assert.deepEqual(
      plans.map((p) => p.lane),
      ["A", "C"],
    );
    assert.equal(
      plans.some((p) => p.lane === "B"),
      false,
    );
  });

  it("leaves all variants unfiltered when garment has no taxonomy mapping", () => {
    const plans = buildVariantFilterPlans({
      garment: "mystery widget",
      brief: { ...sampleBrief, budget_context: { stated: false } },
      profile,
      queries: ["mystery widget a", "mystery widget b"],
    });
    assert.equal(plans.every((p) => !p.category_filtered), true);
    assert.equal(plans.every((p) => p.filters.categories === undefined), true);
  });
});

describe("buildSlotCatalogFilters", () => {
  it("always applies ships_to, available, and buyer context fields via caller", () => {
    const filters = buildSlotCatalogFilters({
      brief: { ...sampleBrief, budget_context: { stated: false } },
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "shirt",
    });
    assert.equal(filters.available, true);
    assert.equal(filters.ships_to?.country, "US");
    assert.equal(filters.categories?.[0]?.includes("aa-1-13-7"), true);
    assert.equal(filters.price, undefined);
    // No department on sample brief → no Target gender attribute
    assert.equal(filters.attributes, undefined);
  });

  it("adds Target gender on category-filtered lanes when department is mens", () => {
    const filters = buildSlotCatalogFilters({
      brief: {
        ...sampleBrief,
        budget_context: { stated: false },
        department_scope: "mens",
        knowledge_state: {
          department: "mens",
          sizes_confirmed: ["shirt"],
          sizes_unconfirmed: [],
        },
      },
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "shirt",
    });
    assert.deepEqual(filters.attributes, [
      { name: "Target gender", values: ["Male", "Unisex"] },
    ]);
  });

  it("pads stated budget ±20% then × relevance guard into cents for single_item server filter", () => {
    const filters = buildSlotCatalogFilters({
      brief: { ...sampleBrief, request_type: "single_item" },
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "shirt",
      mode: "single_item",
    });
    // enforced = 100 * 1.2 = 120; guard = 120 * 2 = 240 → 24000 cents
    assert.equal(filters.price?.max, 24_000);
    assert.equal(filters.price?.min, 3_200);
  });

  it("uses per-slot allocation padding × relevance guard for outfit mode server filter", () => {
    const outfitBrief = {
      ...sampleBrief,
      request_type: "outfit" as const,
      budget_context: { stated: true, max: 300, currency: "USD" },
    };
    const allocation = {
      bounds: new Map([["shirt", { max: 147 }]]),
      per_slot: {
        shirt: {
          fraction: 0.35,
          fraction_source: "planner" as const,
          allocated_max: 105,
          padded_max: 147,
        },
      },
      validation: "accepted" as const,
    };
    const filters = buildSlotCatalogFilters({
      brief: outfitBrief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "shirt",
      mode: "outfit",
      slotId: "shirt",
      allocation,
    });
    // guard_max = 147 * 2 = 294 → 29400 cents
    assert.equal(filters.price?.max, 29_400);
    assert.notEqual(filters.price?.max, 14_700);
  });

  it("omits category on reformulation pass", () => {
    const filters = buildSlotCatalogFilters({
      brief: sampleBrief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "shirt",
      options: { omitCategory: true },
    });
    assert.equal(filters.categories, undefined);
  });
});

describe("composeSlotIntentString", () => {
  it("combines occasion, style, palette, nice-to-haves, and positive signals", () => {
    const intent = composeSlotIntentString({
      slot: sampleSlot,
      brief: sampleBrief,
      profile: {
        countryCode: "US",
        currency: "USD",
        positiveSignals: ["slim silhouettes"],
      },
    });
    assert.match(intent, /work_consultant/);
    assert.match(intent, /neutral monochrome/);
    assert.match(intent, /premium cotton/);
    assert.match(intent, /slim silhouettes/);
  });

  it("can drop color nudge for reformulation", () => {
    const intent = composeSlotIntentString({
      slot: {
        ...sampleSlot,
        palette_constraint: "black neutral palette",
      },
      brief: sampleBrief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      dropColorNudge: true,
    });
    assert.equal(intent.includes("black"), false);
  });

  it("dedupes overlapping intent phrases from style and nice_to_haves", () => {
    assert.equal(
      dedupeIntentParts([
        "elegant, lightweight",
        "Elegant",
        "lightweight, warm weather",
      ]),
      "elegant, lightweight, warm weather",
    );
    const intent = composeSlotIntentString({
      slot: {
        ...sampleSlot,
        style_direction: "elegant, lightweight",
        palette_constraint: null,
      },
      brief: {
        ...sampleBrief,
        style_direction: "elegant, lightweight",
        nice_to_haves: ["elegant", "lightweight", "warm weather"],
      },
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
    });
    assert.equal((intent.match(/\belegant\b/gi) ?? []).length, 1);
    assert.equal((intent.match(/\blightweight\b/gi) ?? []).length, 1);
  });
});

describe("dedupeSlotCatalogHits", () => {
  it("merges matched_by across variant indices", () => {
    const product = { id: "gid://shopify/p/1", title: "Oxford" } as CatalogProductSummary;
    const deduped = dedupeSlotCatalogHits([
      { variantIndex: 0, products: [product], category_filtered: false },
      { variantIndex: 1, products: [product], category_filtered: true },
    ]);
    assert.equal(deduped.length, 1);
    assert.deepEqual(deduped[0]!.matched_by, [0, 1]);
    assert.equal(deduped[0]!.matched_only_unfiltered, false);
    assert.equal(deduped[0]!.raw.title, "Oxford");
  });

  it("flags matched_only_unfiltered when only unfiltered lanes hit", () => {
    const onlyUnfiltered = { id: "gid://shopify/p/2", title: "Denim" } as CatalogProductSummary;
    const deduped = dedupeSlotCatalogHits([
      { variantIndex: 0, products: [onlyUnfiltered], category_filtered: false },
      { variantIndex: 1, products: [], category_filtered: true },
    ]);
    assert.equal(deduped[0]!.matched_only_unfiltered, true);
  });
});

describe("buildReformulationQueryVariants", () => {
  it("returns two fresh queries not in the prior set", () => {
    const variants = buildReformulationQueryVariants({
      slot: sampleSlot,
      priorVariants: sampleSlot.query_variants,
    });
    assert.equal(variants.length, 2);
    for (const v of variants) {
      assert.equal(
        sampleSlot.query_variants.some((p) => p.toLowerCase() === v.toLowerCase()),
        false,
      );
    }
  });
});

describe("fashionCatalogReadyToDisplay", () => {
  it("keeps the loader up while the hydration rack is still provisional", () => {
    assert.equal(
      fashionCatalogReadyToDisplay({
        version: 1,
        slots: [],
        timing_ms: 1,
        provisional: true,
        curation: { version: 1 } as never,
        render: { looks: [{ name: "Look 1", item_refs: ["a"] }] } as never,
      }),
      false,
    );
  });

  it("is ready once final curation arrives", () => {
    assert.equal(
      fashionCatalogReadyToDisplay({
        version: 1,
        slots: [{ verified_pool: [{ id: "p1" }] } as never],
        timing_ms: 1,
      }),
      true,
    );
  });
});
