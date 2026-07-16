import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOCATION_PAD_MAX,
  BUDGET_ASSEMBLY_TOLERANCE,
  CAPSULE_PIECE_PAD,
  LEGACY_BUDGET_PAD_MAX,
  RELEVANCE_GUARD_MULTIPLIER,
  priceBoundsForSlot,
  resolveAllocation,
} from "./budgetAllocation";
import {
  applyLiftedMax,
  evaluateBudgetLift,
} from "./budgetLift";
import { computeBudgetTension } from "./budgetTension";
import { buildSlotCatalogFilters } from "../catalog-search/slot-filters";
import { buildSearchPlannerPrompt } from "../search-planner/prompt";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { HardDropMetrics } from "../hard-drops/types";

const baseBrief: FashionSearchBrief = {
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

function makePlan(
  overrides: Partial<FashionSearchPlan> & {
    slots?: FashionSearchPlan["slots"];
    mode?: FashionSearchPlan["mode"];
    brief?: FashionSearchBrief;
  } = {},
): FashionSearchPlan {
  return {
    version: 1,
    mode: overrides.mode ?? "outfit",
    reasoning: "test",
    currentDate: "2026-07-10",
    brief: overrides.brief ?? baseBrief,
    slots: overrides.slots ?? [
      {
        slot_id: "shirt",
        garment: "shirt",
        role: "support",
        style_direction: "oxford",
        palette_constraint: "navy",
        palette_source: "occasion_default",
        options_wanted: 3,
        query_variants: ["mens oxford shirt", "mens cotton shirt"],
        budget_fraction: 0.4,
      },
      {
        slot_id: "trousers",
        garment: "trousers",
        role: "support",
        style_direction: "slim chinos",
        palette_constraint: "grey",
        palette_source: "occasion_default",
        options_wanted: 3,
        query_variants: ["mens chino trousers", "mens slim pants"],
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
        query_variants: ["mens leather loafers", "mens office shoes"],
        budget_fraction: 0.25,
      },
    ],
    ...overrides,
  };
}

function product(id: string, priceMajor: number): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: `Product ${id}`,
    variant_options: [],
    price: { amount: Math.round(priceMajor * 100), currency: "USD" },
    image_urls: [],
    raw: {} as FashionSlotCatalogProduct["raw"],
  };
}

describe("outfit_300_planner_fractions", () => {
  it("allocates per-slot max = 300 × fraction × 1.4, not flat $300", () => {
    const plan = makePlan();
    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);

    const shirt = allocation!.per_slot.shirt!;
    const trousers = allocation!.per_slot.trousers!;
    const shoes = allocation!.per_slot.shoes!;

    assert.notEqual(shirt.fraction, trousers.fraction);
    assert.notEqual(shirt.fraction, shoes.fraction);
    assert.ok(Math.abs(shirt.fraction + trousers.fraction + shoes.fraction - 1) < 0.01);

    assert.equal(shirt.padded_max, 300 * shirt.fraction * ALLOCATION_PAD_MAX);
    assert.equal(trousers.padded_max, 300 * trousers.fraction * ALLOCATION_PAD_MAX);
    assert.equal(shoes.padded_max, 300 * shoes.fraction * ALLOCATION_PAD_MAX);

    for (const slotId of ["shirt", "trousers", "shoes"]) {
      const enforced = priceBoundsForSlot({
        brief: plan.brief,
        mode: "outfit",
        slotId,
        allocation,
        profileCurrency: "USD",
        purpose: "client_enforcement",
      });
      const server = priceBoundsForSlot({
        brief: plan.brief,
        mode: "outfit",
        slotId,
        allocation,
        profileCurrency: "USD",
        purpose: "server_filter",
      });
      const slotAlloc = allocation!.per_slot[slotId]!;
      assert.equal(enforced?.max, Math.round(slotAlloc.padded_max * 100));
      assert.equal(
        server?.max,
        Math.round(slotAlloc.padded_max * RELEVANCE_GUARD_MULTIPLIER * 100),
      );
      assert.notEqual(enforced?.max, Math.round(300 * 1.2 * 100));
    }
  });
});

describe("winter_look_coat_dominates", () => {
  it("gives coat slot the largest fraction and padded max", () => {
    const plan = makePlan({
      brief: {
        ...baseBrief,
        occasion_context: "winter wedding guest",
        style_direction: "Formal winter wedding look.",
      },
      slots: [
        {
          slot_id: "coat",
          garment: "wool coat",
          role: "anchor",
          style_direction: "formal overcoat",
          palette_constraint: "charcoal",
          palette_source: "occasion_default",
          options_wanted: 3,
          query_variants: ["mens wool overcoat", "mens formal coat"],
          budget_fraction: 0.5,
        },
        {
          slot_id: "shirt",
          garment: "shirt",
          role: "support",
          style_direction: "dress shirt",
          palette_constraint: "white",
          palette_source: "occasion_default",
          options_wanted: 3,
          query_variants: ["mens dress shirt", "mens formal shirt"],
          budget_fraction: 0.3,
        },
        {
          slot_id: "shoes",
          garment: "shoes",
          role: "support",
          style_direction: "oxfords",
          palette_constraint: "black",
          palette_source: "occasion_default",
          options_wanted: 3,
          query_variants: ["mens oxford shoes", "mens formal shoes"],
          budget_fraction: 0.2,
        },
      ],
    });

    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);

    const coatMax = allocation!.per_slot.coat!.padded_max;
    const shirtMax = allocation!.per_slot.shirt!.padded_max;
    const shoesMax = allocation!.per_slot.shoes!.padded_max;

    assert.ok(coatMax > shirtMax);
    assert.ok(coatMax > shoesMax);
    assert.equal(allocation!.per_slot.coat!.fraction, 0.5);
  });
});

describe("clamp_and_renormalize", () => {
  it("clamps floor 0.10 and renormalizes when sum is 0.85 and one slot is 0.05", () => {
    const plan = makePlan({
      slots: [
        {
          slot_id: "a",
          garment: "shirt",
          role: "anchor",
          style_direction: "a",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 3,
          query_variants: ["mens shirt a", "mens shirt b"],
          budget_fraction: 0.05,
        },
        {
          slot_id: "b",
          garment: "trousers",
          role: "support",
          style_direction: "b",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 3,
          query_variants: ["mens pants a", "mens pants b"],
          budget_fraction: 0.4,
        },
        {
          slot_id: "c",
          garment: "shoes",
          role: "support",
          style_direction: "c",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 3,
          query_variants: ["mens shoes a", "mens shoes b"],
          budget_fraction: 0.4,
        },
      ],
    });

    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);
    assert.equal(allocation!.validation, "clamped");
    assert.equal(allocation!.per_slot.a!.fraction_source, "clamped");
    assert.ok(allocation!.per_slot.a!.fraction >= 0.1);

    const sum = Object.values(allocation!.per_slot).reduce(
      (n, s) => n + s.fraction,
      0,
    );
    assert.ok(Math.abs(sum - 1) < 0.001);
  });
});

describe("fallback_table", () => {
  it("uses static-table fallback when fractions are missing", () => {
    const plan = makePlan({
      slots: makePlan().slots.map((s) => {
        const { budget_fraction: _, ...rest } = s;
        return rest;
      }),
    });

    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);
    assert.equal(allocation!.validation, "fallback");
    assert.equal(allocation!.per_slot.shirt!.fraction_source, "fallback");

    for (const slotId of ["shirt", "trousers", "shoes"]) {
      const bounds = priceBoundsForSlot({
        brief: plan.brief,
        mode: "outfit",
        slotId,
        allocation,
        profileCurrency: "USD",
      });
      assert.ok(bounds?.max);
    }
  });
});

describe("single_item_unchanged", () => {
  it("keeps ±20% behavior and emits no allocation fractions", () => {
    const brief: FashionSearchBrief = {
      ...baseBrief,
      request_type: "single_item",
      garments: ["shirt"],
      budget_context: { stated: true, max: 100, currency: "USD" },
    };
    const plan = makePlan({
      mode: "single_item",
      brief,
      slots: [
        {
          slot_id: "shirt",
          garment: "shirt",
          role: "anchor",
          style_direction: "oxford",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 4,
          query_variants: ["mens oxford shirt", "mens cotton shirt"],
        },
      ],
    });

    const allocation = resolveAllocation(plan, "USD");
    assert.equal(allocation, null);

    const filters = buildSlotCatalogFilters({
      brief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "shirt",
      mode: "single_item",
    });
    assert.equal(
      filters.price?.max,
      Math.round(100 * LEGACY_BUDGET_PAD_MAX * RELEVANCE_GUARD_MULTIPLIER * 100),
    );
  });
});

describe("no_budget_noop", () => {
  it("returns no price filters when budget is unstated", () => {
    const brief = {
      ...baseBrief,
      budget_context: { stated: false },
    };
    const plan = makePlan({ brief });

    const allocation = resolveAllocation(plan, "USD");
    assert.equal(allocation, null);

    const filters = buildSlotCatalogFilters({
      brief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
      garment: "shirt",
      mode: "outfit",
    });
    assert.equal(filters.price, undefined);
  });
});

describe("multi_item_per_item_assumption", () => {
  it("caps each slot at ~$100 with per_item_assumed flag", () => {
    const brief: FashionSearchBrief = {
      ...baseBrief,
      request_type: "multi_item",
      garments: ["shirt", "sneakers"],
      budget_context: { stated: true, max: 100, currency: "USD" },
    };
    const plan = makePlan({
      mode: "multi_item",
      brief,
      slots: [
        {
          slot_id: "shirt",
          garment: "shirt",
          role: "anchor",
          style_direction: "casual",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 3,
          query_variants: ["mens shirt", "mens tee"],
        },
        {
          slot_id: "sneakers",
          garment: "sneakers",
          role: "anchor",
          style_direction: "casual",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 3,
          query_variants: ["mens sneakers", "mens trainers"],
        },
      ],
    });

    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);
    assert.equal(allocation!.budget_interpretation, "per_item_assumed");

    for (const slotId of ["shirt", "sneakers"]) {
      const bounds = priceBoundsForSlot({
        brief,
        mode: "multi_item",
        slotId,
        allocation,
        profileCurrency: "USD",
      });
      assert.equal(bounds?.max, Math.round(100 * LEGACY_BUDGET_PAD_MAX * 100));
    }
  });
});

describe("shoe_slot_budget_lift", () => {
  it("computes lifted_max = 330 - 95 = 235 for starved shoe slot (secondary + market path)", () => {
    const plan = makePlan();
    const allocation = resolveAllocation(plan, "USD")!;

    const slots = [
      {
        slot_id: "shirt",
        products: [product("s1", 35), product("s2", 50)],
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
        products: [product("t1", 60), product("t2", 80)],
        market_prices: {
          p10: 55,
          p50: 60,
          p90: 80,
          min_viable: 60,
          sample_size: 5,
        },
      },
      {
        slot_id: "shoes",
        products: [product("sh1", 200)],
        market_prices: {
          p10: 90,
          p50: 110,
          p90: 150,
          min_viable: 80,
          sample_size: 12,
        },
        budget_dropped_pool: [
          product("sh90", 90),
          product("sh110", 110),
        ],
      },
    ];

    const metrics: HardDropMetrics[] = [
      { in: 20, out: 2, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
      { in: 20, out: 2, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
      {
        in: 20,
        out: 1,
        drops_by_rule: { budget: 18 },
        suspicions_by_rule: {},
        ms: 1,
      },
    ];

    const rawCounts = new Map([
      ["shirt", 20],
      ["trousers", 20],
      ["shoes", 20],
    ]);
    const budgetDrops = new Map([
      ["shirt", 0],
      ["trousers", 0],
      ["shoes", 18],
    ]);

    const decisions = evaluateBudgetLift({
      allocation,
      slots,
      hardDropMetrics: metrics,
      rawCounts,
      budgetDrops,
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

    const tension = computeBudgetTension({
      allocation: lifted,
      slots,
      hardDropMetrics: metrics,
      liftedSlots: new Set(["shoes"]),
      preLiftSurvivorCounts: new Map([["shoes", 1]]),
      preLiftBudgetDrops: budgetDrops,
    });
    assert.equal(tension.severity, "tight");
    assert.ok(tension.slots.some((s) => s.signal === "lifted"));
  });
});

describe("no_room_to_lift", () => {
  it("skips lift when cheapest viables consume the total", () => {
    const plan = makePlan();
    const allocation = resolveAllocation(plan, "USD")!;

    const slots = [
      { slot_id: "shirt", products: [product("s1", 120)] },
      { slot_id: "trousers", products: [product("t1", 150)] },
      {
        slot_id: "shoes",
        products: [product("sh1", 180)],
      },
    ];

    const metrics: HardDropMetrics[] = [
      { in: 20, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
      { in: 20, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
      {
        in: 20,
        out: 1,
        drops_by_rule: { budget: 15 },
        suspicions_by_rule: {},
        ms: 1,
      },
    ];

    const decisions = evaluateBudgetLift({
      allocation,
      slots,
      hardDropMetrics: metrics,
      rawCounts: new Map([
        ["shirt", 20],
        ["trousers", 20],
        ["shoes", 20],
      ]),
      budgetDrops: new Map([
        ["shirt", 0],
        ["trousers", 0],
        ["shoes", 15],
      ]),
    });

    const shoeDecision = decisions.find((d) => d.slot_id === "shoes");
    assert.equal(shoeDecision?.should_lift, false);
    assert.equal(shoeDecision?.skip_reason, "no_room");

    const tension = computeBudgetTension({
      allocation,
      slots,
      hardDropMetrics: metrics,
      liftedSlots: new Set(),
      preLiftSurvivorCounts: new Map([["shoes", 1]]),
      preLiftBudgetDrops: new Map([["shoes", 15]]),
    });
    assert.equal(tension.severity, "tight");
  });
});

describe("infeasible_slot", () => {
  it("persists infeasible severity when shoe slot has zero survivors after lift", () => {
    const plan = makePlan();
    const allocation = resolveAllocation(plan, "USD")!;

    const slots = [
      { slot_id: "shirt", products: [product("s1", 35)] },
      { slot_id: "trousers", products: [product("t1", 60)] },
      { slot_id: "shoes", products: [] },
    ];

    const metrics: HardDropMetrics[] = [
      { in: 10, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
      { in: 10, out: 1, drops_by_rule: {}, suspicions_by_rule: {}, ms: 1 },
      {
        in: 10,
        out: 0,
        drops_by_rule: { budget: 10 },
        suspicions_by_rule: {},
        ms: 1,
      },
    ];

    const tension = computeBudgetTension({
      allocation,
      slots,
      hardDropMetrics: metrics,
      liftedSlots: new Set(["shoes"]),
      preLiftSurvivorCounts: new Map([["shoes", 0]]),
      preLiftBudgetDrops: new Map([["shoes", 10]]),
    });

    assert.equal(tension.severity, "infeasible");
    assert.ok(
      tension.slots.some(
        (s) => s.slot_id === "shoes" && s.signal === "budget_drops_dominant",
      ),
    );
  });
});

describe("oversized_budget", () => {
  it("flags oversized when stated $800 exceeds composed p90 of ~$310", () => {
    const plan = makePlan({
      brief: {
        ...baseBrief,
        budget_context: { stated: true, max: 800, currency: "USD" },
      },
    });
    const allocation = resolveAllocation(plan, "USD")!;

    const slots = [
      {
        slot_id: "shirt",
        products: Array.from({ length: 10 }, (_, i) => product(`s${i}`, 30 + i * 5)),
      },
      {
        slot_id: "trousers",
        products: Array.from({ length: 10 }, (_, i) => product(`t${i}`, 50 + i * 5)),
      },
      {
        slot_id: "shoes",
        products: Array.from({ length: 10 }, (_, i) => product(`sh${i}`, 70 + i * 5)),
      },
    ];

    const metrics: HardDropMetrics[] = slots.map(() => ({
      in: 10,
      out: 10,
      drops_by_rule: {},
      suspicions_by_rule: {},
      ms: 1,
    }));

    const tension = computeBudgetTension({
      allocation,
      slots,
      hardDropMetrics: metrics,
      liftedSlots: new Set(),
      preLiftSurvivorCounts: new Map(),
      preLiftBudgetDrops: new Map(),
    });

    assert.equal(tension.severity, "oversized");
    assert.ok(
      tension.slots.some((s) => s.signal === "headroom_above_p90"),
    );
  });
});

describe("planner prompt", () => {
  it("includes BUDGET ALLOCATION instructions in STEP 1", () => {
    const prompt = buildSearchPlannerPrompt();
    assert.match(prompt, /BUDGET ALLOCATION:/);
    assert.match(prompt, /budget_fraction/);
    assert.match(prompt, /budget_fraction summing to 1 across[\s\S]*slots/);
  });
});

function makeCapsulePlan(
  overrides: Partial<FashionSearchPlan> = {},
): FashionSearchPlan {
  return makePlan({
    mode: "capsule",
    brief: {
      ...baseBrief,
      request_type: "capsule",
      garments: ["shirt", "trousers", "shoes"],
      quantity_hint: "3 outfits",
    },
    slots: [
      {
        slot_id: "tops",
        garment: "shirt",
        role: "anchor",
        style_direction: "casual tops",
        palette_constraint: null,
        palette_source: "spread",
        options_wanted: 3,
        query_variants: ["mens shirt", "mens tee"],
        budget_fraction: 0.45,
      },
      {
        slot_id: "bottoms",
        garment: "trousers",
        role: "support",
        style_direction: "chinos",
        palette_constraint: null,
        palette_source: "spread",
        options_wanted: 2,
        query_variants: ["mens chinos", "mens pants"],
        budget_fraction: 0.35,
      },
      {
        slot_id: "shoes",
        garment: "shoes",
        role: "support",
        style_direction: "sneakers",
        palette_constraint: null,
        palette_source: "spread",
        options_wanted: 1,
        query_variants: ["mens sneakers", "mens trainers"],
        budget_fraction: 0.2,
      },
    ],
    ...overrides,
  });
}

describe("capsule_300_per_piece_bounds", () => {
  it("divides slot allocation by piece count with PIECE_PAD 1.5", () => {
    const plan = makeCapsulePlan();
    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);
    assert.equal(allocation!.budget_interpretation, "set_total_assumed");
    assert.equal(allocation!.budget_assembly?.constraint_type, "set_total");

    const tops = allocation!.per_slot.tops!;
    const bottoms = allocation!.per_slot.bottoms!;
    const shoes = allocation!.per_slot.shoes!;

    const expectedTops = (300 * 0.45 * CAPSULE_PIECE_PAD) / 3;
    const expectedBottoms = (300 * 0.35 * CAPSULE_PIECE_PAD) / 2;
    const expectedShoes = (300 * 0.2 * CAPSULE_PIECE_PAD) / 1;

    assert.ok(Math.abs(tops.per_item_enforced! - expectedTops) < 0.01);
    assert.ok(Math.abs(bottoms.per_item_enforced! - expectedBottoms) < 0.01);
    assert.ok(Math.abs(shoes.per_item_enforced! - expectedShoes) < 0.01);

    assert.equal(tops.per_item_guard, tops.per_item_enforced! * RELEVANCE_GUARD_MULTIPLIER);
    assert.equal(tops.pieces, 3);
    assert.equal(bottoms.pieces, 2);
    assert.equal(shoes.pieces, 1);

    // Must not send undivided set allocation as enforcement ceiling.
    assert.notEqual(tops.padded_max, 300 * 0.45 * CAPSULE_PIECE_PAD);

    for (const [slotId, expected] of [
      ["tops", expectedTops],
      ["bottoms", expectedBottoms],
      ["shoes", expectedShoes],
    ] as const) {
      const enforced = priceBoundsForSlot({
        brief: plan.brief,
        mode: "capsule",
        slotId,
        allocation,
        profileCurrency: "USD",
        purpose: "client_enforcement",
      });
      const server = priceBoundsForSlot({
        brief: plan.brief,
        mode: "capsule",
        slotId,
        allocation,
        profileCurrency: "USD",
        purpose: "server_filter",
      });
      assert.equal(enforced?.max, Math.round(expected * 100));
      assert.equal(
        server?.max,
        Math.round(expected * RELEVANCE_GUARD_MULTIPLIER * 100),
      );
    }
  });
});

describe("capsule_lift_math", () => {
  it("computes room with piece-count multiplication and divides lift by pieces", () => {
    const plan = makeCapsulePlan();
    const allocation = resolveAllocation(plan, "USD")!;

    const slots = [
      {
        slot_id: "tops",
        products: [
          product("t1", 35),
          product("t2", 40),
          product("t3", 45),
        ],
        market_prices: {
          p10: 35,
          p50: 40,
          p90: 45,
          min_viable: 35,
          sample_size: 5,
        },
      },
      {
        slot_id: "bottoms",
        products: [product("b1", 95)],
        market_prices: {
          p10: 90,
          p50: 95,
          p90: 110,
          min_viable: 85,
          sample_size: 8,
        },
        budget_dropped_pool: [product("b85", 85), product("b88", 88)],
      },
      {
        slot_id: "shoes",
        products: [product("s1", 55)],
        market_prices: {
          p10: 50,
          p50: 55,
          p90: 70,
          min_viable: 50,
          sample_size: 5,
        },
      },
    ];

    const metrics: HardDropMetrics[] = slots.map(() => ({
      in: 20,
      out: 3,
      drops_by_rule: { budget: 5 },
      suspicions_by_rule: {},
      ms: 1,
    }));

    const decisions = evaluateBudgetLift({
      allocation,
      slots,
      hardDropMetrics: metrics,
      rawCounts: new Map([
        ["tops", 20],
        ["bottoms", 20],
        ["shoes", 20],
      ]),
      budgetDrops: new Map([
        ["tops", 0],
        ["bottoms", 12],
        ["shoes", 0],
      ]),
    });

    const bottomDecision = decisions.find((d) => d.slot_id === "bottoms");
    assert.ok(bottomDecision?.should_lift);
    const room = 300 * (1 + BUDGET_ASSEMBLY_TOLERANCE) - (35 * 3 + 50);
    assert.equal(room, 330 - 155);
    assert.equal(bottomDecision!.lifted_max, room / 2);
    assert.equal(bottomDecision!.lifted_max, 87.5);
  });
});

describe("outfit_per_look_unchanged", () => {
  it("keeps per-look constraint and undivided per-slot padded max", () => {
    const plan = makePlan();
    const allocation = resolveAllocation(plan, "USD");
    assert.ok(allocation);
    assert.equal(allocation!.budget_assembly?.constraint_type, "per_look");
    // Ambiguous stated total (no scope) → set_total_assumed; never undefined.
    assert.equal(allocation!.budget_interpretation, "set_total_assumed");

    const shirt = allocation!.per_slot.shirt!;
    assert.equal(shirt.padded_max, 300 * shirt.fraction * ALLOCATION_PAD_MAX);
    assert.equal(shirt.per_item_enforced, undefined);
    assert.equal(shirt.pieces, undefined);
  });

  it("sets total_stated when router scope is total", () => {
    const plan = makePlan({
      brief: {
        ...baseBrief,
        budget_context: {
          stated: true,
          max: 300,
          currency: "USD",
          scope: "total",
        },
      },
    });
    const allocation = resolveAllocation(plan, "USD");
    assert.equal(allocation?.budget_interpretation, "total_stated");
  });
});
