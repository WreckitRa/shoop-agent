/**
 * Relevance-guard fixtures: server price filter is a loose guard (×2 padded);
 * client hard-drop still enforces padded_max; guard-band items lift-readmit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { buildVariantFilterPlans } from "../catalog-search/category-hedge";
import { buildSlotCatalogFilters } from "../catalog-search/slot-filters";
import { applyHardDrops } from "../hard-drops/apply-hard-drops";
import {
  ALLOCATION_PAD_MAX,
  RELEVANCE_GUARD_MULTIPLIER,
  guardMaxMajor,
  priceBoundsForSlot,
  resolveAllocation,
} from "../budget/budgetAllocation";
import {
  evaluateBudgetLift,
  readmitBudgetDroppedProducts,
} from "../budget/budgetLift";
import { computeBudgetTension } from "../budget/budgetTension";
import type { FashionSearchPlan } from "../search-planner/types";
import type { HardDropMetrics } from "../hard-drops/types";
import { toMinorUnits } from "@/lib/money";

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

function fiveSlotBrief(): FashionSearchBrief {
  return {
    recipient_person_id: "joe",
    request_type: "outfit",
    garments: ["dress shirt", "blazer", "dress pants", "dress shoes", "tie"],
    occasion_context: "business event",
    quantity_hint: "full formal outfit",
    must_haves: [],
    nice_to_haves: [],
    budget_context: { stated: true, max: 100, currency: "USD" },
    style_direction: "Polished formal business outfit.",
    department_scope: "mens",
    knowledge_state: {
      department: "mens",
      sizes_confirmed: [],
      sizes_unconfirmed: [],
    },
  };
}

function fiveSlotPlan(brief: FashionSearchBrief = fiveSlotBrief()): FashionSearchPlan {
  const garments = brief.garments;
  return {
    version: 1,
    mode: "outfit",
    reasoning: "test",
    currentDate: "2026-07-10",
    brief,
    slots: garments.map((garment, i) => ({
      slot_id: garment.replace(/\s+/g, "_"),
      garment,
      role: i === 1 ? ("anchor" as const) : ("support" as const),
      style_direction: garment,
      palette_constraint: null,
      palette_source: "occasion_default" as const,
      options_wanted: 3,
      query_variants: [`mens ${garment}`, `mens formal ${garment}`, `mens business ${garment}`, `mens premium ${garment}`],
      budget_fraction: 1 / garments.length,
    })),
  };
}

describe("tight_budget_guard_band", () => {
  it("priced lanes carry 2× padded guard; guard-band blazers budget-drop then lift-readmit; tension tight", () => {
    const plan = fiveSlotPlan();
    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);

    const blazerId = "blazer";
    const blazerAlloc = allocation!.per_slot[blazerId];
    assert.ok(blazerAlloc);
    const enforced = blazerAlloc!.padded_max;
    const guard = guardMaxMajor(enforced);

    const profile = { countryCode: "US", currency: "USD", positiveSignals: [] };
    const plans = buildVariantFilterPlans({
      garment: "blazer",
      brief: plan.brief,
      profile,
      queries: ["mens blazer", "mens suit jacket", "mens sportcoat"],
      mode: "outfit",
      slotId: blazerId,
      allocation,
    });

    const priced = plans.filter((p) => p.lane === "A" || p.lane === "C");
    assert.ok(priced.length >= 2);
    for (const p of priced) {
      assert.equal(p.filters.price?.max, toMinorUnits(guard));
    }
    const laneB = plans.find((p) => p.lane === "B");
    assert.equal(laneB?.filters.price, undefined);

    // Real mens blazers in the guard band ($60–90) — over enforced, under guard.
    const enforcedCents = toMinorUnits(enforced);
    const inBand = [
      product("b60", {
        title: "Mens Navy Blazer",
        price: { amount: toMinorUnits(60), currency: "USD" },
        matched_by_lanes: ["A", "C"],
      }),
      product("b75", {
        title: "Mens Charcoal Blazer",
        price: { amount: toMinorUnits(75), currency: "USD" },
        matched_by_lanes: ["A"],
      }),
      product("b90", {
        title: "Mens Wool Blazer",
        price: { amount: toMinorUnits(90), currency: "USD" },
        matched_by_lanes: ["C"],
      }),
    ].filter((p) => {
      const a = p.price!.amount;
      return a > enforcedCents && a <= toMinorUnits(guard);
    });

    // If enforced is already > $90 (unlikely at $100/5), force padded down for fixture.
    const products =
      inBand.length >= 2
        ? inBand
        : [
            product("b60", {
              title: "Mens Navy Blazer",
              price: { amount: toMinorUnits(60), currency: "USD" },
              matched_by_lanes: ["A", "C"],
            }),
            product("b75", {
              title: "Mens Charcoal Blazer",
              price: { amount: toMinorUnits(75), currency: "USD" },
              matched_by_lanes: ["A"],
            }),
          ];

    // Force a tight padded_max so $60–75 are in the guard band.
    const tightAlloc = {
      ...allocation!,
      per_slot: {
        ...allocation!.per_slot,
        [blazerId]: {
          ...blazerAlloc!,
          padded_max: 40,
          allocated_max: 40 / ALLOCATION_PAD_MAX,
        },
      },
    };

    const drops = applyHardDrops({
      slot: { slot_id: blazerId, garment: "blazer" },
      products,
      recipientFacts: [],
      brief: plan.brief,
      mode: "outfit",
      allocation: tightAlloc,
      profileCurrency: "USD",
    });

    assert.ok((drops.guard_band_count ?? 0) >= 2);
    assert.ok(drops.budget_dropped_pool.length >= 2);
    assert.equal(drops.survivors.length, 0);

    const clientBound = priceBoundsForSlot({
      brief: plan.brief,
      mode: "outfit",
      slotId: blazerId,
      allocation: tightAlloc,
      profileCurrency: "USD",
      purpose: "client_enforcement",
    });
    assert.equal(clientBound?.max, toMinorUnits(40));

    const serverBound = priceBoundsForSlot({
      brief: plan.brief,
      mode: "outfit",
      slotId: blazerId,
      allocation: tightAlloc,
      profileCurrency: "USD",
      purpose: "server_filter",
    });
    assert.equal(
      serverBound?.max,
      toMinorUnits(40 * RELEVANCE_GUARD_MULTIPLIER),
    );

    const otherSlots = plan.slots
      .filter((s) => s.slot_id !== blazerId)
      .map((s) => ({
        slot_id: s.slot_id,
        products: [
          product(`${s.slot_id}_ok`, {
            price: { amount: toMinorUnits(15), currency: "USD" },
          }),
        ],
        market_prices: {
          p10: 12,
          p50: 15,
          p90: 20,
          min_viable: 10,
          sample_size: 5,
        },
      }));

    const decisions = evaluateBudgetLift({
      allocation: tightAlloc,
      slots: [
        ...otherSlots,
        {
          slot_id: blazerId,
          products: [],
          market_prices: {
            p10: 55,
            p50: 70,
            p90: 90,
            min_viable: 55,
            sample_size: 5,
          },
          budget_dropped_pool: drops.budget_dropped_pool,
        },
      ],
      hardDropMetrics: plan.slots.map(() => ({
        in: 5,
        out: 0,
        drops_by_rule: { budget: 3 },
        suspicions_by_rule: {},
        ms: 1,
      })) as HardDropMetrics[],
    });

    const blazerLift = decisions.find((d) => d.slot_id === blazerId);
    assert.ok(blazerLift?.should_lift);
    assert.equal(blazerLift!.skip_requery, true);

    const readmitted = readmitBudgetDroppedProducts({
      pool: drops.budget_dropped_pool,
      liftedMaxMajor: blazerLift!.lifted_max!,
    });
    assert.ok(readmitted.length >= 1);
    assert.ok(readmitted.every((p) => p.budget_lift_readmitted));

    const tension = computeBudgetTension({
      allocation: tightAlloc,
      slots: [
        ...otherSlots,
        {
          slot_id: blazerId,
          products: readmitted,
          market_prices: {
            p10: 55,
            p50: 70,
            p90: 90,
            min_viable: 55,
            sample_size: 5,
          },
        },
      ],
      hardDropMetrics: plan.slots.map(() => ({
        in: 5,
        out: 1,
        drops_by_rule: { budget: 2 },
        suspicions_by_rule: {},
        ms: 1,
      })),
      liftedSlots: new Set([blazerId]),
      preLiftSurvivorCounts: new Map(
        plan.slots.map((s) => [s.slot_id, s.slot_id === blazerId ? 0 : 1]),
      ),
      preLiftBudgetDrops: new Map(
        plan.slots.map((s) => [s.slot_id, s.slot_id === blazerId ? 3 : 0]),
      ),
    });
    assert.ok(
      tension.severity === "tight" || tension.severity === "infeasible",
    );
  });
});

describe("generous_budget_unchanged_behavior", () => {
  it("when stated budget is well above market p90, guard is inert for relevant inventory", () => {
    const brief: FashionSearchBrief = {
      ...fiveSlotBrief(),
      budget_context: { stated: true, max: 5000, currency: "USD" },
    };
    const plan = fiveSlotPlan(brief);
    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);

    const blazerAlloc = allocation!.per_slot.blazer!;
    // Market p90 ~$200; padded for blazer at $5000 total is huge.
    assert.ok(blazerAlloc.padded_max > 200);

    const products = [
      product("b1", {
        title: "Mens Navy Blazer",
        price: { amount: toMinorUnits(120), currency: "USD" },
        matched_by_lanes: ["A", "C"],
      }),
      product("b2", {
        title: "Mens Charcoal Blazer",
        price: { amount: toMinorUnits(180), currency: "USD" },
        matched_by_lanes: ["C"],
      }),
    ];

    const drops = applyHardDrops({
      slot: { slot_id: "blazer", garment: "blazer" },
      products,
      recipientFacts: [],
      brief,
      mode: "outfit",
      allocation,
      profileCurrency: "USD",
    });

    assert.equal(drops.survivors.length, 2);
    assert.equal(drops.budget_dropped_pool.length, 0);
    assert.equal(drops.guard_band_count ?? 0, 0);
  });
});

describe("no_budget_noop", () => {
  it("sends no price bounds on any lane when budget is unstated", () => {
    const brief: FashionSearchBrief = {
      ...fiveSlotBrief(),
      budget_context: { stated: false },
      request_type: "single_item",
      garments: ["blazer"],
    };
    const filters = buildSlotCatalogFilters({
      brief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "blazer",
      mode: "single_item",
    });
    assert.equal(filters.price, undefined);

    const plans = buildVariantFilterPlans({
      garment: "blazer",
      brief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      queries: ["mens blazer", "mens jacket"],
      mode: "single_item",
    });
    for (const p of plans) {
      assert.equal(p.filters.price, undefined);
    }
  });
});

describe("junk_share_guard_vs_enforcement", () => {
  it("priced-lane junk share is lower under guard bounds than enforcement-only baseline", () => {
    // Baseline: tight enforcement bound fills priced lanes with junk (socks/tees).
    // Guard: same junk exists but real blazers at $60–80 also enter → lower junk %.
    const brief = fiveSlotBrief();
    const plan = fiveSlotPlan(brief);
    const allocation = resolveAllocation(plan, "USD")!;
    const tight = {
      ...allocation,
      per_slot: {
        ...allocation.per_slot,
        blazer: {
          ...allocation.per_slot.blazer!,
          padded_max: 25,
          allocated_max: 25 / ALLOCATION_PAD_MAX,
        },
      },
    };

    const junk = [
      product("tee", {
        title: "V-Neck Tee",
        price: { amount: toMinorUnits(15), currency: "USD" },
        matched_by_lanes: ["A", "C"],
      }),
      product("sock", {
        title: "Dress Socks",
        price: { amount: toMinorUnits(12), currency: "USD" },
        matched_by_lanes: ["A"],
      }),
      product("lace", {
        title: "Shoe Laces",
        price: { amount: toMinorUnits(8), currency: "USD" },
        matched_by_lanes: ["C"],
      }),
    ];
    const real = [
      product("b35", {
        title: "Mens Navy Blazer Structured",
        price: { amount: toMinorUnits(35), currency: "USD" },
        matched_by_lanes: ["A", "C"],
      }),
      product("b45", {
        title: "Mens Charcoal Wool Blazer",
        price: { amount: toMinorUnits(45), currency: "USD" },
        matched_by_lanes: ["A"],
      }),
    ];

    // Enforcement-only retrieval picture: only junk under $25.
    const baseline = applyHardDrops({
      slot: { slot_id: "blazer", garment: "blazer" },
      products: junk,
      recipientFacts: [],
      brief,
      mode: "outfit",
      allocation: tight,
      profileCurrency: "USD",
    });
    const baselinePriced = junk.length;
    const baselineJunk = baseline.dropped.filter(
      (d) =>
        d.rule === "category_mismatch" ||
        d.rule === "department_mismatch" ||
        d.rule === "item_type_mismatch",
    ).length;
    const baselineRatio = baselineJunk / baselinePriced;

    // Guard retrieval picture: junk + real blazers in guard band.
    const withGuard = applyHardDrops({
      slot: { slot_id: "blazer", garment: "blazer" },
      products: [...junk, ...real],
      recipientFacts: [],
      brief,
      mode: "outfit",
      allocation: tight,
      profileCurrency: "USD",
    });
    const guardPriced = junk.length + real.length;
    const guardJunk = withGuard.dropped.filter(
      (d) =>
        d.rule === "category_mismatch" ||
        d.rule === "department_mismatch" ||
        d.rule === "item_type_mismatch",
    ).length;
    const guardRatio = guardJunk / guardPriced;

    assert.ok(
      guardRatio < baselineRatio,
      `expected guard junk share ${guardRatio} < baseline ${baselineRatio}`,
    );
    assert.ok((withGuard.guard_band_count ?? 0) >= 2);
    // Real blazers are budget-dropped (not junk-dropped) under enforcement.
    assert.ok(
      withGuard.budget_dropped_pool.some((p) => p.id === "b35"),
    );
  });
});
