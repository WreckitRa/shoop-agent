import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { HardDropMetrics } from "../hard-drops/types";
import {
  BUDGET_ASSEMBLY_TOLERANCE,
  type ResolvedBudgetAllocation,
  type SlotBudgetAllocation,
} from "./budgetAllocation";

export const THIN_SLOT_THRESHOLD = 15;
export const LIFT_READMIT_MIN = 10;

export type SlotMarketPrices = {
  p10: number;
  p50: number;
  p90: number;
  min_viable: number;
  sample_size: number;
};

export type BudgetLiftDecision = {
  slot_id: string;
  should_lift: boolean;
  lifted_max?: number;
  original_padded_max: number;
  cheapest_viables: Record<string, number>;
  skip_reason?: "no_room" | "not_starved" | "not_budget_cause";
  /** Prefer re-admitting measured Lane B / guard-band products before a re-query. */
  prefer_readmission?: boolean;
  /**
   * When true (tight/infeasible market), do NOT run additional retrieval —
   * Lane B + guard-band already hold the honest inventory picture.
   */
  skip_requery?: boolean;
};

export type EvaluateBudgetLiftParams = {
  allocation: ResolvedBudgetAllocation;
  slots: Array<{
    slot_id: string;
    products: FashionSlotCatalogProduct[];
    market_prices?: SlotMarketPrices;
    budget_dropped_pool?: FashionSlotCatalogProduct[];
  }>;
  hardDropMetrics: HardDropMetrics[];
  /** @deprecated count-based — kept for secondary signals / legacy fixtures */
  rawCounts?: Map<string, number>;
  budgetDrops?: Map<string, number>;
};

/**
 * Lift when market_prices.p10 > padded_max and head-room exists.
 * cheapest_viable for other slots comes from market_prices.min_viable (real
 * Lane B numbers), falling back to survivor min price.
 */
export function evaluateBudgetLift(
  params: EvaluateBudgetLiftParams,
): BudgetLiftDecision[] {
  const assembly = params.allocation.budget_assembly;
  if (!assembly) return [];

  const totalMax = assembly.total_max;
  const decisions: BudgetLiftDecision[] = [];

  for (let i = 0; i < params.slots.length; i++) {
    const slot = params.slots[i]!;
    const slotAlloc = params.allocation.per_slot[slot.slot_id];
    if (!slotAlloc) continue;

    const market = slot.market_prices;
    const p10 = market?.p10;
    const budgetStarved =
      p10 != null && p10 > slotAlloc.padded_max;

    // Secondary: thin survivors with budget drops (legacy junk-fill-blind path).
    const survivorCount = slot.products.length;
    const budgetDropCount =
      params.budgetDrops?.get(slot.slot_id) ??
      params.hardDropMetrics[i]?.drops_by_rule?.budget ??
      0;
    const secondaryStarved =
      survivorCount < THIN_SLOT_THRESHOLD && budgetDropCount > 0;

    if (!budgetStarved && !secondaryStarved) {
      decisions.push({
        slot_id: slot.slot_id,
        should_lift: false,
        original_padded_max: slotAlloc.padded_max,
        cheapest_viables: {},
        skip_reason: "not_starved",
      });
      continue;
    }

    const cheapest_viables: Record<string, number> = {};
    let otherMinSum = 0;
    let allOthersHavePrice = true;

    for (const other of params.slots) {
      if (other.slot_id === slot.slot_id) continue;
      const cv =
        other.market_prices?.min_viable ??
        cheapestViable(other.products);
      if (cv == null) {
        allOthersHavePrice = false;
        break;
      }
      cheapest_viables[other.slot_id] = cv;
      otherMinSum += cv;
    }

    if (!allOthersHavePrice) {
      decisions.push({
        slot_id: slot.slot_id,
        should_lift: false,
        original_padded_max: slotAlloc.padded_max,
        cheapest_viables,
        skip_reason: "not_budget_cause",
      });
      continue;
    }

    const lifted_max =
      totalMax * (1 + BUDGET_ASSEMBLY_TOLERANCE) - otherMinSum;

    if (lifted_max <= slotAlloc.padded_max) {
      decisions.push({
        slot_id: slot.slot_id,
        should_lift: false,
        original_padded_max: slotAlloc.padded_max,
        cheapest_viables,
        skip_reason: "no_room",
      });
      continue;
    }

    decisions.push({
      slot_id: slot.slot_id,
      should_lift: true,
      lifted_max,
      original_padded_max: slotAlloc.padded_max,
      cheapest_viables,
      prefer_readmission: Boolean(slot.budget_dropped_pool?.length),
      // Tight/infeasible market: honest picture already in Lane B + guard band.
      skip_requery: budgetStarved,
    });
  }

  return decisions;
}

function cheapestViable(products: FashionSlotCatalogProduct[]): number | null {
  const prices = products
    .map((p) => p.price?.amount)
    .filter((a): a is number => a != null && Number.isFinite(a))
    .map((cents) => fromMinorUnits(cents));
  if (!prices.length) return null;
  return Math.min(...prices);
}

/**
 * Re-admit budget-dropped products whose price ≤ lifted_max (major units).
 * Returns the readmitted products flagged with budget_lift_readmitted.
 */
export function readmitBudgetDroppedProducts(params: {
  pool: FashionSlotCatalogProduct[];
  liftedMaxMajor: number;
}): FashionSlotCatalogProduct[] {
  const maxCents = toMinorUnits(params.liftedMaxMajor);
  return params.pool
    .filter((p) => {
      const amount = p.price?.amount;
      return amount != null && Number.isFinite(amount) && amount <= maxCents;
    })
    .map((p) => ({
      ...p,
      budget_lift_readmitted: true,
    }));
}

export function applyLiftedMax(
  allocation: ResolvedBudgetAllocation,
  slotId: string,
  liftedMax: number,
): ResolvedBudgetAllocation {
  const slotAlloc = allocation.per_slot[slotId];
  if (!slotAlloc) return allocation;

  const updatedSlot: SlotBudgetAllocation = {
    ...slotAlloc,
    padded_max: liftedMax,
  };

  const per_slot = {
    ...allocation.per_slot,
    [slotId]: updatedSlot,
  };

  const bounds = new Map(allocation.bounds);
  const existing = bounds.get(slotId) ?? {};
  bounds.set(slotId, { ...existing, max: liftedMax });

  return {
    ...allocation,
    per_slot,
    bounds,
    budget_assembly: allocation.budget_assembly
      ? {
          ...allocation.budget_assembly,
          per_slot_allocated: per_slot,
        }
      : undefined,
  };
}
