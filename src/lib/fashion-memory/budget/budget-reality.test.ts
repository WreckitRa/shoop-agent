/**
 * Budget-reality fixtures: UCP junk-fill, Lane B market prices, category_mismatch,
 * lift-by-readmission, and related hard-drop / tension behavior.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { taxonomyCategoriesForGarment } from "../catalog-search/garment-taxonomy";
import { buildVariantFilterPlans } from "../catalog-search/category-hedge";
import { applyHardDrops } from "../hard-drops/apply-hard-drops";
import {
  ALLOCATION_PAD_MAX,
  BUDGET_ASSEMBLY_TOLERANCE,
  resolveAllocation,
} from "../budget/budgetAllocation";
import {
  applyLiftedMax,
  evaluateBudgetLift,
  readmitBudgetDroppedProducts,
} from "../budget/budgetLift";
import { computeBudgetTension } from "../budget/budgetTension";
import type { FashionSearchPlan } from "../search-planner/types";
import type { HardDropMetrics } from "../hard-drops/types";

const SHOES_GID = taxonomyCategoriesForGarment("shoes")[0]!;
const SOCKS_GID = "gid://shopify/TaxonomyCategory/aa-1-13-11"; // not shoes family
const LACES_GID = "gid://shopify/TaxonomyCategory/aa-2-6-9";

function product(
  id: string,
  overrides: Partial<FashionSlotCatalogProduct> = {},
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: overrides.matched_by ?? [0],
    matched_by_color_variant: false,
    matched_by_lanes: overrides.matched_by_lanes,
    title: overrides.title ?? `Product ${id}`,
    variant_options: [],
    image_urls: [],
    price: overrides.price,
    taxonomy_category: overrides.taxonomy_category,
    raw: (overrides.raw ?? {
      id,
      title: overrides.title ?? `Product ${id}`,
    }) as CatalogProductSummary,
  };
}

const mensBrief: FashionSearchBrief = {
  recipient_person_id: "abcd",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "work_consultant",
  quantity_hint: "one outfit",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: true, max: 300, currency: "USD" },
  style_direction: "Smart casual office look.",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: [],
    sizes_unconfirmed: [],
  },
};

function makeOutfitPlan(
  brief: FashionSearchBrief = mensBrief,
): FashionSearchPlan {
  return {
    version: 1,
    mode: "outfit",
    reasoning: "test",
    currentDate: "2026-07-10",
    brief,
    slots: [
      {
        slot_id: "shirt",
        garment: "shirt",
        role: "support",
        style_direction: "oxford",
        palette_constraint: "navy",
        palette_source: "occasion_default",
        options_wanted: 3,
        query_variants: [
          "mens oxford shirt",
          "mens formal cotton shirt",
          "mens business shirt",
          "mens premium shirt",
        ],
        budget_fraction: 0.4,
      },
      {
        slot_id: "trousers",
        garment: "trousers",
        role: "support",
        style_direction: "chinos",
        palette_constraint: "grey",
        palette_source: "occasion_default",
        options_wanted: 3,
        query_variants: [
          "mens chino trousers",
          "mens dress pants tailored",
          "mens business trousers",
          "mens formal pants",
        ],
        budget_fraction: 0.35,
      },
      {
        slot_id: "shoes",
        garment: "shoes",
        role: "support",
        style_direction: "loafers",
        palette_constraint: "brown",
        palette_source: "occasion_default",
        options_wanted: 3,
        query_variants: [
          "mens leather loafers",
          "mens dress shoes oxford",
          "mens business shoes",
          "mens formal footwear",
        ],
        budget_fraction: 0.25,
      },
    ],
  };
}

describe("shoes_under_10_junk_fill", () => {
  it("kills socks/laces/baby shoes; market_prices → infeasible; junk composition ready", () => {
    const tightBrief: FashionSearchBrief = {
      ...mensBrief,
      budget_context: { stated: true, max: 30, currency: "USD" },
      request_type: "single_item",
      garments: ["shoes"],
    };

    const junkAndReal: FashionSlotCatalogProduct[] = [
      product("sock1", {
        title: "Ankle Socks Pack",
        price: { amount: 800, currency: "USD" },
        taxonomy_category: SOCKS_GID,
        matched_by_lanes: ["C"],
      }),
      product("lace1", {
        title: "Shoe Laces",
        price: { amount: 500, currency: "USD" },
        taxonomy_category: LACES_GID,
        matched_by_lanes: ["C"],
      }),
      product("baby1", {
        title: "Baby Soft Sole Shoes",
        price: { amount: 900, currency: "USD" },
        taxonomy_category: SHOES_GID,
        matched_by_lanes: ["C"],
      }),
      // Lane B real shoes (over the $10-ish bound)
      product("shoe45", {
        title: "Mens Leather Loafer",
        price: { amount: 4500, currency: "USD" },
        taxonomy_category: SHOES_GID,
        matched_by_lanes: ["B"],
      }),
      product("shoe60", {
        title: "Mens Oxford Shoe",
        price: { amount: 6000, currency: "USD" },
        taxonomy_category: SHOES_GID,
        matched_by_lanes: ["B"],
      }),
      product("shoe80", {
        title: "Mens Derby",
        price: { amount: 8000, currency: "USD" },
        taxonomy_category: SHOES_GID,
        matched_by_lanes: ["B"],
      }),
    ];

    const result = applyHardDrops({
      slot: { slot_id: "shoes", garment: "shoes" },
      products: junkAndReal,
      recipientFacts: [],
      brief: tightBrief,
      mode: "single_item",
      profileCurrency: "USD",
    });

    assert.ok(
      result.dropped.some((d) => d.rule === "category_mismatch"),
      "socks/laces should category_mismatch",
    );
    assert.ok(
      result.dropped.some((d) => d.rule === "department_mismatch"),
      "baby shoes should department_mismatch via title tokens",
    );
    assert.ok(result.market_prices);
    assert.ok(result.market_prices!.p10 >= 45);
    assert.ok(result.market_prices!.min_viable >= 45);

    // Real shoes measured then budget-dropped under a tiny single-item pad.
    assert.ok(
      result.budget_dropped_pool.length >= 2 ||
        result.survivors.every((s) => (s.price?.amount ?? 0) <= 1200 * 1.2),
    );

    const junkRules = result.dropped.filter(
      (d) =>
        d.rule === "category_mismatch" || d.rule === "department_mismatch",
    ).length;
    assert.ok(
      junkRules / junkAndReal.length > 0.3,
      "junk composition should be majority-ish of priced junk",
    );
  });
});

describe("lift_by_readmission", () => {
  it("re-admits Lane B shoes at $80–120 without a new query", () => {
    const plan = makeOutfitPlan();
    const allocation = resolveAllocation(plan, "USD")!;
    const shoesPadded = allocation.per_slot.shoes!.padded_max;

    const pool = [
      product("sh80", {
        title: "Mens Loafer",
        price: { amount: 8000, currency: "USD" },
        taxonomy_category: SHOES_GID,
        matched_by_lanes: ["B"],
      }),
      product("sh100", {
        title: "Mens Oxford",
        price: { amount: 10_000, currency: "USD" },
        taxonomy_category: SHOES_GID,
        matched_by_lanes: ["B"],
      }),
      product("sh120", {
        title: "Mens Derby",
        price: { amount: 12_000, currency: "USD" },
        taxonomy_category: SHOES_GID,
        matched_by_lanes: ["B"],
      }),
    ];

    assert.ok(shoesPadded < 120, "shoes padded max should be below Lane B shoe prices");

    const slots = [
      {
        slot_id: "shirt",
        products: [product("s1", { price: { amount: 3500, currency: "USD" } })],
        market_prices: {
          p10: 35,
          p50: 40,
          p90: 50,
          min_viable: 35,
          sample_size: 5,
        },
      },
      {
        slot_id: "trousers",
        products: [product("t1", { price: { amount: 6000, currency: "USD" } })],
        market_prices: {
          p10: 55,
          p50: 60,
          p90: 80,
          min_viable: 55,
          sample_size: 5,
        },
      },
      {
        slot_id: "shoes",
        products: [],
        market_prices: {
          p10: 80,
          p50: 100,
          p90: 120,
          min_viable: 80,
          sample_size: 3,
        },
        budget_dropped_pool: pool,
      },
    ];

    const decisions = evaluateBudgetLift({
      allocation,
      slots,
      hardDropMetrics: [
        { in: 5, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        { in: 5, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        {
          in: 20,
          out: 0,
          drops_by_rule: { budget: 15 },
          suspicions_by_rule: {},
          ms: 1,
        },
      ],
    });

    const shoeDecision = decisions.find((d) => d.slot_id === "shoes");
    assert.ok(shoeDecision?.should_lift);
    assert.ok(shoeDecision!.lifted_max! > shoesPadded);

    const readmitted = readmitBudgetDroppedProducts({
      pool,
      liftedMaxMajor: shoeDecision!.lifted_max!,
    });
    assert.ok(readmitted.length >= 2);
    assert.ok(readmitted.every((p) => p.budget_lift_readmitted === true));
  });
});

describe("socks_dropped_no_budget", () => {
  it("drops sock-category products in a shoe slot with no budget stated", () => {
    const brief: FashionSearchBrief = {
      ...mensBrief,
      budget_context: { stated: false },
      request_type: "single_item",
      garments: ["shoes"],
    };
    const result = applyHardDrops({
      slot: { slot_id: "shoes", garment: "shoes" },
      products: [
        product("sock", {
          title: "Crew Socks",
          taxonomy_category: SOCKS_GID,
          matched_by_lanes: ["A"],
        }),
        product("shoe", {
          title: "Leather Loafer",
          taxonomy_category: SHOES_GID,
          matched_by_lanes: ["C"],
        }),
      ],
      recipientFacts: [],
      brief,
    });
    assert.ok(
      result.dropped.some(
        (d) => d.product_id === "sock" && d.rule === "category_mismatch",
      ),
    );
    assert.ok(result.survivors.some((s) => s.id === "shoe"));
  });
});

describe("no_category_survives", () => {
  it("keeps right-priced products with no taxonomy category", () => {
    const brief: FashionSearchBrief = {
      ...mensBrief,
      budget_context: { stated: false },
      request_type: "single_item",
      garments: ["shoes"],
    };
    const result = applyHardDrops({
      slot: { slot_id: "shoes", garment: "shoes" },
      products: [
        product("unknown", {
          title: "Classic Loafer",
          price: { amount: 9000, currency: "USD" },
          matched_by_lanes: ["C"],
        }),
      ],
      recipientFacts: [],
      brief,
    });
    assert.equal(result.dropped.length, 0);
    assert.equal(result.survivors.length, 1);
  });
});

describe("lane_collapse_no_budget", () => {
  it("emits exactly A + C when no budget is stated", () => {
    const plans = buildVariantFilterPlans({
      garment: "shoes",
      brief: { ...mensBrief, budget_context: { stated: false } },
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      queries: ["mens loafers", "mens dress shoes", "mens leather shoes"],
    });
    assert.ok(plans.length >= 2);
    assert.equal(plans.some((p) => p.lane === "B"), false);
    assert.equal(plans[0]!.lane, "A");
    assert.ok(plans.slice(1).every((p) => p.lane === "C"));
  });
});

describe("shoe_slot_budget_lift", () => {
  it("triggers on market_prices.p10 > padded_max and prefers readmission", () => {
    const plan = makeOutfitPlan();
    const allocation = resolveAllocation(plan, "USD")!;
    const shoesPadded = allocation.per_slot.shoes!.padded_max;

    const slots = [
      {
        slot_id: "shirt",
        products: [product("s1", { price: { amount: 3500, currency: "USD" } })],
        market_prices: {
          p10: 35,
          p50: 40,
          p90: 50,
          min_viable: 35,
          sample_size: 8,
        },
      },
      {
        slot_id: "trousers",
        products: [product("t1", { price: { amount: 6000, currency: "USD" } })],
        market_prices: {
          p10: 55,
          p50: 60,
          p90: 75,
          min_viable: 60,
          sample_size: 8,
        },
      },
      {
        slot_id: "shoes",
        products: [product("sh1", { price: { amount: 20_000, currency: "USD" } })],
        market_prices: {
          p10: 110,
          p50: 120,
          p90: 150,
          min_viable: 80,
          sample_size: 12,
        },
        budget_dropped_pool: [
          product("sh90", {
            price: { amount: 9000, currency: "USD" },
            matched_by_lanes: ["B"],
            taxonomy_category: SHOES_GID,
          }),
          product("sh110", {
            price: { amount: 11_000, currency: "USD" },
            matched_by_lanes: ["B"],
            taxonomy_category: SHOES_GID,
          }),
        ],
      },
    ];

    assert.ok(shoesPadded < 110);

    const decisions = evaluateBudgetLift({
      allocation,
      slots,
      hardDropMetrics: [
        { in: 20, out: 2, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        { in: 20, out: 2, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        {
          in: 20,
          out: 1,
          drops_by_rule: { budget: 18 },
          suspicions_by_rule: {},
          ms: 1,
        },
      ] satisfies HardDropMetrics[],
    });

    const shoeDecision = decisions.find((d) => d.slot_id === "shoes");
    assert.ok(shoeDecision?.should_lift);
    assert.equal(
      shoeDecision!.lifted_max,
      300 * (1 + BUDGET_ASSEMBLY_TOLERANCE) - (35 + 60),
    );
    assert.equal(shoeDecision!.lifted_max, 235);
    assert.equal(shoeDecision!.prefer_readmission, true);

    const lifted = applyLiftedMax(allocation, "shoes", 235);
    assert.equal(lifted.per_slot.shoes!.padded_max, 235);

    const readmitted = readmitBudgetDroppedProducts({
      pool: slots[2]!.budget_dropped_pool!,
      liftedMaxMajor: 235,
    });
    assert.equal(readmitted.length, 2);

    const tension = computeBudgetTension({
      allocation: lifted,
      slots,
      hardDropMetrics: [
        { in: 20, out: 2, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        { in: 20, out: 2, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        {
          in: 20,
          out: 1,
          drops_by_rule: { budget: 18 },
          suspicions_by_rule: {},
          ms: 1,
        },
      ],
      liftedSlots: new Set(["shoes"]),
      preLiftSurvivorCounts: new Map([["shoes", 1]]),
      preLiftBudgetDrops: new Map([["shoes", 18]]),
    });
    assert.equal(tension.severity, "tight");
    assert.ok(tension.slots.some((s) => s.signal === "lifted"));
  });
});

describe("market_prices_infeasible_tension", () => {
  it("marks infeasible when padded_max < market min_viable", () => {
    const plan = makeOutfitPlan({
      ...mensBrief,
      budget_context: { stated: true, max: 80, currency: "USD" },
    });
    const allocation = resolveAllocation(plan, "USD")!;
    // Force a tiny shoes padded max for the assertion.
    const shoesAlloc = allocation.per_slot.shoes!;
    shoesAlloc.padded_max = 20;
    shoesAlloc.allocated_max = 20 / ALLOCATION_PAD_MAX;

    const tension = computeBudgetTension({
      allocation,
      slots: [
        {
          slot_id: "shirt",
          products: [product("s1", { price: { amount: 2000, currency: "USD" } })],
          market_prices: {
            p10: 20,
            p50: 25,
            p90: 30,
            min_viable: 18,
            sample_size: 5,
          },
        },
        {
          slot_id: "trousers",
          products: [product("t1", { price: { amount: 2500, currency: "USD" } })],
          market_prices: {
            p10: 22,
            p50: 28,
            p90: 35,
            min_viable: 20,
            sample_size: 5,
          },
        },
        {
          slot_id: "shoes",
          products: [],
          market_prices: {
            p10: 45,
            p50: 60,
            p90: 90,
            min_viable: 45,
            sample_size: 8,
          },
        },
      ],
      hardDropMetrics: [
        { in: 5, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        { in: 5, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
        {
          in: 20,
          out: 0,
          drops_by_rule: { budget: 10, category_mismatch: 8 },
          suspicions_by_rule: {},
          ms: 1,
        },
      ],
      liftedSlots: new Set(),
      preLiftSurvivorCounts: new Map([["shoes", 0]]),
      preLiftBudgetDrops: new Map([["shoes", 10]]),
    });

    assert.equal(tension.severity, "infeasible");
    assert.ok(
      tension.slots.some(
        (s) => s.slot_id === "shoes" && s.signal === "infeasible_market",
      ),
    );
  });
});
