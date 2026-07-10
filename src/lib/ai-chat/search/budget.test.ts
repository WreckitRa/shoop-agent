import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  budgetOverageCaveat,
  budgetRetrievalFilter,
  judgePriceAgainstBudget,
  SOFT_BUDGET_RETRIEVAL_MULTIPLIER,
} from "./budget";
import type { SearchBriefBudget } from "./types";

const hard = (amountCents: number): SearchBriefBudget => ({
  amountCents,
  type: "hard",
  currency: "USD",
});
const soft = (amountCents: number): SearchBriefBudget => ({
  amountCents,
  type: "soft",
  currency: "USD",
});
const none = (): SearchBriefBudget => ({
  amountCents: null,
  type: "none",
  currency: "USD",
});

describe("budgetRetrievalFilter", () => {
  it("caps hard budgets at the target", () => {
    assert.deepEqual(budgetRetrievalFilter(hard(10_000)), {
      priceMaxCents: 10_000,
    });
  });

  it("widens soft budgets by the retrieval multiplier", () => {
    assert.deepEqual(budgetRetrievalFilter(soft(10_000)), {
      priceMaxCents: Math.round(10_000 * SOFT_BUDGET_RETRIEVAL_MULTIPLIER),
    });
  });

  it("applies no ceiling for none budgets", () => {
    assert.deepEqual(budgetRetrievalFilter(none()), {});
  });

  it("threads a price floor through", () => {
    assert.deepEqual(budgetRetrievalFilter(none(), 2_500), {
      priceMinCents: 2_500,
    });
  });
});

describe("judgePriceAgainstBudget", () => {
  it("treats under-budget as not over", () => {
    const v = judgePriceAgainstBudget(8_000, hard(10_000));
    assert.equal(v.over, false);
    assert.equal(v.hardViolation, false);
  });

  it("flags any overage on a hard budget as a hard violation", () => {
    const v = judgePriceAgainstBudget(10_100, hard(10_000));
    assert.equal(v.over, true);
    assert.equal(v.hardViolation, true);
  });

  it("allows a small soft overage but not a large one", () => {
    const small = judgePriceAgainstBudget(10_500, soft(10_000)); // 5%
    assert.equal(small.over, true);
    assert.equal(small.hardViolation, false);

    const big = judgePriceAgainstBudget(12_000, soft(10_000)); // 20% > 10%
    assert.equal(big.over, true);
    assert.equal(big.hardViolation, true);
  });

  it("detects a gift sub-floor (suspiciously cheap)", () => {
    const v = judgePriceAgainstBudget(3_000, hard(10_000), { isGift: true });
    assert.equal(v.over, false);
    assert.equal(v.belowGiftFloor, true);
  });

  it("ignores price when budget is none", () => {
    const v = judgePriceAgainstBudget(999_999, none());
    assert.equal(v.over, false);
    assert.equal(v.hardViolation, false);
  });
});

describe("budgetOverageCaveat", () => {
  it("renders a rounded percentage", () => {
    assert.equal(budgetOverageCaveat(0.05), "5% over budget");
    assert.equal(budgetOverageCaveat(0.123), "12% over budget");
  });
});
