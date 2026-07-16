import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlan } from "../search-planner/types";
import { BUDGET_ASSEMBLY_TOLERANCE } from "./budgetAllocation";
import {
  BUDGET_RAISE_CONTINUE_OPTION,
  buildBudgetRaiseAskFromContext,
  buildBudgetRaiseClarification,
  estimateMinViableSetTotal,
  parseBudgetRaiseAnswer,
  shouldAskBudgetRaise,
  suggestRaisedBudgets,
} from "./budget-raise-ask";

const brief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "outfit",
  garments: ["blazer", "dress shirt", "dress pants", "dress shoes", "tie"],
  occasion_context: "formal",
  quantity_hint: "one outfit",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: true, max: 100, currency: "USD" },
  style_direction: "Formal look.",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: [],
    sizes_unconfirmed: [],
  },
};

function outfitPlan(max: number): FashionSearchPlan {
  return {
    version: 1,
    mode: "outfit",
    reasoning: "test",
    currentDate: "2026-07-14",
    brief: {
      ...brief,
      budget_context: { stated: true, max, currency: "USD" },
    },
    slots: [
      {
        slot_id: "blazer",
        garment: "blazer",
        role: "anchor",
        options_wanted: 3,
        query_variants: ["blazer"],
        style_direction: "formal",
        palette_constraint: "spread",
        palette_source: "occasion_default",
      },
      {
        slot_id: "dress_shirt",
        garment: "dress shirt",
        role: "support",
        options_wanted: 3,
        query_variants: ["shirt"],
        style_direction: "formal",
        palette_constraint: "spread",
        palette_source: "occasion_default",
      },
      {
        slot_id: "dress_pants",
        garment: "dress pants",
        role: "support",
        options_wanted: 3,
        query_variants: ["pants"],
        style_direction: "formal",
        palette_constraint: "spread",
        palette_source: "occasion_default",
      },
    ],
    budget_allocation: {
      bounds: new Map(),
      per_slot: {},
      validation: "accepted",
      budget_assembly: {
        total_max: max,
        currency: "USD",
        tolerance: BUDGET_ASSEMBLY_TOLERANCE,
        constraint_type: "per_look",
        per_slot_allocated: {},
      },
    },
  };
}

describe("estimateMinViableSetTotal", () => {
  it("sums min_viable across slots with market prices", () => {
    assert.equal(
      estimateMinViableSetTotal([
        { slot_id: "a", market_prices: { min_viable: 40 } },
        { slot_id: "b", market_prices: { min_viable: 55.5 } },
        { slot_id: "c" },
      ]),
      95.5,
    );
  });

  it("returns null when no market prices", () => {
    assert.equal(
      estimateMinViableSetTotal([{ slot_id: "a" }, { slot_id: "b" }]),
      null,
    );
  });
});

describe("shouldAskBudgetRaise", () => {
  it("asks on infeasible tension", () => {
    const plan = outfitPlan(300);
    assert.equal(
      shouldAskBudgetRaise({
        plan,
        tension: { severity: "infeasible", slots: [] },
        slots: [
          { slot_id: "blazer", market_prices: { min_viable: 80 } },
          { slot_id: "dress_shirt", market_prices: { min_viable: 30 } },
        ],
      }),
      true,
    );
  });

  it("asks when outfit min-viable sum exceeds ceiling", () => {
    const plan = outfitPlan(100);
    assert.equal(
      shouldAskBudgetRaise({
        plan,
        tension: { severity: "tight", slots: [] },
        slots: [
          { slot_id: "blazer", market_prices: { min_viable: 90 } },
          { slot_id: "dress_shirt", market_prices: { min_viable: 35 } },
          { slot_id: "dress_pants", market_prices: { min_viable: 40 } },
        ],
      }),
      true,
    );
  });

  it("does not ask when tight but fundable", () => {
    const plan = outfitPlan(300);
    assert.equal(
      shouldAskBudgetRaise({
        plan,
        tension: { severity: "tight", slots: [] },
        slots: [
          { slot_id: "blazer", market_prices: { min_viable: 80 } },
          { slot_id: "dress_shirt", market_prices: { min_viable: 35 } },
          { slot_id: "dress_pants", market_prices: { min_viable: 40 } },
        ],
      }),
      false,
    );
  });

  it("does not ask when skip is set (continue-anyway)", () => {
    const plan = outfitPlan(100);
    assert.equal(
      shouldAskBudgetRaise({
        plan,
        tension: { severity: "infeasible", slots: [] },
        slots: [{ slot_id: "blazer", market_prices: { min_viable: 200 } }],
        skip: true,
      }),
      false,
    );
  });

  it("does not ask for single_item mode on set-sum alone", () => {
    const plan: FashionSearchPlan = {
      ...outfitPlan(50),
      mode: "single_item",
      budget_allocation: {
        bounds: new Map(),
        per_slot: {},
        validation: "accepted",
        budget_assembly: {
          total_max: 50,
          currency: "USD",
          tolerance: BUDGET_ASSEMBLY_TOLERANCE,
          constraint_type: "per_look",
          per_slot_allocated: {},
        },
      },
    };
    assert.equal(
      shouldAskBudgetRaise({
        plan,
        tension: { severity: "tight", slots: [] },
        slots: [{ slot_id: "blazer", market_prices: { min_viable: 200 } }],
      }),
      false,
    );
  });
});

describe("buildBudgetRaiseClarification", () => {
  it("includes raise chips, continue option, and budget gap", () => {
    const ask = buildBudgetRaiseClarification({
      statedMax: 100,
      minViableTotal: 280,
      currency: "USD",
      garments: ["blazer", "shirt", "pants"],
      reason: "set_below_min_viable",
    });
    assert.match(ask.reply, /\$280|280/);
    assert.equal(ask.questions.length, 1);
    assert.equal(ask.questions[0]!.gap, "budget");
    assert.equal(ask.questions[0]!.field, "budget_max");
    const opts = ask.questions[0]!.quick_options ?? [];
    assert.ok(opts.includes(BUDGET_RAISE_CONTINUE_OPTION));
    assert.ok(opts.some((o) => /^\$\d+/.test(o)));
  });
});

describe("buildBudgetRaiseAskFromContext", () => {
  it("returns ask payload when gate fires", () => {
    const ask = buildBudgetRaiseAskFromContext({
      plan: outfitPlan(100),
      tension: { severity: "tight", slots: [] },
      slots: [
        { slot_id: "blazer", market_prices: { min_viable: 90 } },
        { slot_id: "dress_shirt", market_prices: { min_viable: 40 } },
        { slot_id: "dress_pants", market_prices: { min_viable: 50 } },
      ],
    });
    assert.ok(ask);
    assert.equal(ask!.reason, "set_below_min_viable");
    assert.equal(ask!.stated_max, 100);
  });

  it("returns null when fundable", () => {
    assert.equal(
      buildBudgetRaiseAskFromContext({
        plan: outfitPlan(400),
        tension: { severity: "none", slots: [] },
        slots: [
          { slot_id: "blazer", market_prices: { min_viable: 80 } },
          { slot_id: "dress_shirt", market_prices: { min_viable: 30 } },
        ],
      }),
      null,
    );
  });
});

describe("parseBudgetRaiseAnswer", () => {
  it("parses dollar chips", () => {
    assert.deepEqual(parseBudgetRaiseAnswer("$250"), {
      kind: "raise",
      max: 250,
    });
  });

  it("detects continue-anyway chip", () => {
    assert.deepEqual(parseBudgetRaiseAnswer(BUDGET_RAISE_CONTINUE_OPTION), {
      kind: "continue",
    });
  });
});

describe("suggestRaisedBudgets", () => {
  it("returns amounts above stated max", () => {
    const raised = suggestRaisedBudgets({
      statedMax: 100,
      minViableTotal: 280,
    });
    assert.ok(raised.length >= 1);
    assert.ok(raised.every((n) => n > 100));
  });
});
