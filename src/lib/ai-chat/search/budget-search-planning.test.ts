import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBrief } from "./archetype";
import {
  buildBudgetPlanningContext,
  buildBudgetAngleUserPrompt,
  hasBudgetUpperLimit,
} from "./budget-search-planning";
import { buildPlannerUserPrompt } from "./query-planner";

describe("budget search planning", () => {
  it("detects when an upper limit is set", () => {
    const withBudget = buildSearchBrief({
      query: "running shoes",
      priceMaxCents: 12_000,
      fields: { budget_type: "hard" },
    });
    assert.equal(hasBudgetUpperLimit(withBudget.budget), true);

    const open = buildSearchBrief({ query: "running shoes" });
    assert.equal(hasBudgetUpperLimit(open.budget), false);
  });

  it("builds planning context from upper and lower limits", () => {
    const brief = buildSearchBrief({
      query: "wireless earbuds",
      priceMinCents: 3_000,
      priceMaxCents: 8_000,
      fields: { budget_type: "soft" },
    });
    const ctx = buildBudgetPlanningContext(brief);
    assert.equal(ctx.has_constraint, true);
    if (!ctx.has_constraint) return;
    assert.equal(ctx.upper_limit.amount, 80);
    assert.equal(ctx.lower_limit?.amount, 30);
    assert.match(ctx.band, /USD 30.*USD 80/);
    assert.match(ctx.planning_instruction, /upper limit|ceiling/i);
  });

  it("includes budget angles slot in planner prompt when constrained", () => {
    const brief = buildSearchBrief({
      query: "birthday gift",
      priceMaxCents: 5_000,
      fields: {
        archetype: "gift_directed",
        direction_label: "Tech",
        recipient: { kind: "other", label: "brother" },
        budget_type: "hard",
      },
    });
    const prompt = JSON.parse(
      buildPlannerUserPrompt(brief, 5, {
        budgetAngles: [
          { angle: "wireless earbuds anc", why: "Fits under $50" },
        ],
      }),
    ) as Record<string, unknown>;
    assert.ok(prompt.budget_search_planning);
    assert.deepEqual(prompt.budget_aware_angles, [
      { angle: "wireless earbuds anc", why: "Fits under $50" },
    ]);
    assert.match(String(prompt.critical), /budget/i);
  });

  it("budget angle user prompt includes ceiling", () => {
    const brief = buildSearchBrief({
      query: "black t-shirt",
      priceMaxCents: 4_000,
      fields: { budget_type: "hard" },
    });
    const raw = buildBudgetAngleUserPrompt(brief, 4);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const budget = parsed.budget as { has_constraint: boolean; band: string };
    assert.equal(budget.has_constraint, true);
    assert.match(budget.band, /USD 40/);
  });
});
