/**
 * Budget logic (docs/search-improvements.md §7).
 *
 * - hard: filters.price.max = target. No overage, ever.
 * - soft: retrieval filter is generous (~1.15x) so good slightly-over items
 *   enter the pool; the "earn the overage" rule is enforced at ranking.
 * - none: no price filter; value scoring handles it.
 */
import type { SearchBriefBudget } from "./types";

/** Multiplier applied to a soft budget for the RETRIEVAL filter (not display). */
export const SOFT_BUDGET_RETRIEVAL_MULTIPLIER = 1.15;

/** Max overage (fraction) a soft-budget pick may show at ranking time. */
export const SOFT_BUDGET_MAX_OVERAGE = 0.1;

/**
 * Composite-score margin a soft over-budget candidate must beat the best
 * in-budget candidate by before it can outrank it.
 */
export const SOFT_BUDGET_EARN_MARGIN = 0.04;

/** Gift items priced under this fraction of the budget read as a "cheap miss". */
export const GIFT_SUB_FLOOR_FRACTION = 0.35;

/** Weight applied to budget-alignment bonus at scoring time. */
export const BUDGET_ALIGNMENT_WEIGHT = 0.12;

/** Weight applied to the gift sub-floor shortfall penalty at scoring time. */
export const GIFT_FLOOR_PENALTY_WEIGHT = 0.35;

/**
 * Score how well a price sits in the buyer's target band [0.5×, 1.1× budget].
 * Returns 0–1; under-budget gifts score low (cheap-miss signal).
 */
export function budgetAlignmentScore(
  priceCents: number | null | undefined,
  budget: SearchBriefBudget | null | undefined,
  opts?: { isGift?: boolean },
): number {
  if (!budget) return 0.5;
  const ceiling = budget.maxCents ?? budget.amountCents;
  if (priceCents == null || ceiling == null || budget.type === "none") {
    return 0.5;
  }
  const low = ceiling * 0.5;
  const high = ceiling * 1.1;
  if (priceCents >= low && priceCents <= high) {
    const sweet = ceiling * 0.75;
    const dist = Math.abs(priceCents - sweet) / ceiling;
    return Math.max(0.7, 1 - dist * 0.5);
  }
  if (priceCents < low) {
    const frac = priceCents / low;
    if (opts?.isGift) return Math.max(0, frac * 0.35);
    return Math.max(0, frac * 0.5);
  }
  const over = (priceCents - high) / ceiling;
  return Math.max(0, 0.4 - over);
}

export type BudgetRetrievalFilter = {
  priceMinCents?: number;
  priceMaxCents?: number;
};

/** Price filter to apply during RETRIEVAL for a given budget. */
export function budgetRetrievalFilter(
  budget: SearchBriefBudget,
  priceMinCents?: number,
): BudgetRetrievalFilter {
  const out: BudgetRetrievalFilter = {};
  const floor = priceMinCents ?? budget.minCents ?? undefined;
  if (floor != null) out.priceMinCents = floor;

  const ceiling = budget.maxCents ?? budget.amountCents;
  if (budget.type === "none" || ceiling == null) return out;
  if (budget.type === "hard") {
    out.priceMaxCents = ceiling;
  } else {
    // soft: pull good slightly-over items into the pool.
    out.priceMaxCents = Math.round(ceiling * SOFT_BUDGET_RETRIEVAL_MULTIPLIER);
  }
  return out;
}

export type BudgetVerdict = {
  /** True when this price is over the buyer's target. */
  over: boolean;
  /** Fraction over target (0 when at/under). */
  overageFraction: number;
  /** Hard violation that must be excluded outright. */
  hardViolation: boolean;
  /** Gift sub-floor: priced suspiciously cheap for a gift budget. */
  belowGiftFloor: boolean;
};

/** Classify a concrete variant price against the brief budget. */
export function judgePriceAgainstBudget(
  priceCents: number | null | undefined,
  budget: SearchBriefBudget | null | undefined,
  opts?: { isGift?: boolean },
): BudgetVerdict {
  const base: BudgetVerdict = {
    over: false,
    overageFraction: 0,
    hardViolation: false,
    belowGiftFloor: false,
  };
  if (
    !budget ||
    priceCents == null ||
    budget.amountCents == null ||
    budget.type === "none"
  ) {
    return base;
  }
  const target = budget.amountCents;
  if (priceCents > target) {
    const overageFraction = (priceCents - target) / target;
    return {
      over: true,
      overageFraction,
      hardViolation:
        budget.type === "hard" ||
        overageFraction > SOFT_BUDGET_MAX_OVERAGE,
      belowGiftFloor: false,
    };
  }
  if (opts?.isGift && priceCents < target * GIFT_SUB_FLOOR_FRACTION) {
    return { ...base, belowGiftFloor: true };
  }
  return base;
}

/** Human caveat line for a soft over-budget pick (docs §7). */
export function budgetOverageCaveat(overageFraction: number): string {
  const pct = Math.round(overageFraction * 100);
  return `${pct}% over budget`;
}

/**
 * Soft penalty for gift items priced well below the budget (Fix 5).
 * Returns a score deduction in [0, GIFT_FLOOR_PENALTY_WEIGHT].
 */
export function giftFloorPenalty(
  priceCents: number | null | undefined,
  budget: SearchBriefBudget | null | undefined,
  isGift: boolean,
): number {
  if (!isGift || !budget || budget.amountCents == null || priceCents == null) {
    return 0;
  }
  const floor = budget.amountCents * GIFT_SUB_FLOOR_FRACTION;
  if (priceCents >= floor) return 0;
  const shortfall = (floor - priceCents) / floor;
  return GIFT_FLOOR_PENALTY_WEIGHT * Math.min(1, Math.max(0, shortfall));
}
