import { fromMinorUnits } from "@/lib/money";
import type { HardDropMetrics } from "../hard-drops/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { ResolvedBudgetAllocation } from "./budgetAllocation";
import { BUDGET_ASSEMBLY_TOLERANCE } from "./budgetAllocation";
import type { SlotMarketPrices } from "./budgetLift";

export type BudgetTensionSignal =
  | "below_p10"
  | "infeasible_market"
  | "budget_drops_dominant"
  | "thin_only_with_filter"
  | "lifted"
  | "headroom_above_p90";

export type BudgetTensionSeverity =
  | "none"
  | "tight"
  | "infeasible"
  | "oversized";

export type BudgetTensionSlot = {
  slot_id: string;
  signal: BudgetTensionSignal;
  evidence: Record<string, unknown>;
};

export type BudgetTension = {
  severity: BudgetTensionSeverity;
  slots: BudgetTensionSlot[];
};

const THIN_SLOT_THRESHOLD = 15;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx] ?? null;
}

function survivorPrices(products: FashionSlotCatalogProduct[]): number[] {
  return products
    .map((p) => p.price?.amount)
    .filter((a): a is number => a != null && Number.isFinite(a))
    .map((cents) => fromMinorUnits(cents));
}

function dominantDropRule(
  dropsByRule: Partial<Record<string, number>>,
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [rule, count] of Object.entries(dropsByRule)) {
    if ((count ?? 0) > bestCount) {
      bestCount = count ?? 0;
      best = rule;
    }
  }
  return best;
}

export type ComputeBudgetTensionParams = {
  allocation: ResolvedBudgetAllocation;
  slots: Array<{
    slot_id: string;
    products: FashionSlotCatalogProduct[];
    market_prices?: SlotMarketPrices;
  }>;
  hardDropMetrics: HardDropMetrics[];
  liftedSlots: Set<string>;
  preLiftSurvivorCounts: Map<string, number>;
  preLiftBudgetDrops: Map<string, number>;
};

/**
 * Tension from Lane B market_prices distributions (primary), with survivor
 * counts as a secondary signal only (junk-fill makes counts unreliable alone).
 *
 * - tight: padded_max < market_prices.p10
 * - infeasible: padded_max < market_prices.min_viable
 * - oversized: stated total > composed p90 across slots (from market or survivors)
 */
export function computeBudgetTension(
  params: ComputeBudgetTensionParams,
): BudgetTension {
  const signals: BudgetTensionSlot[] = [];
  let hasInfeasible = false;
  let hasTight = false;

  for (let i = 0; i < params.slots.length; i++) {
    const slot = params.slots[i]!;
    const slotAlloc = params.allocation.per_slot[slot.slot_id];
    const dropMetrics = params.hardDropMetrics[i];
    const budgetDrops = dropMetrics?.drops_by_rule?.budget ?? 0;
    const dominant = dominantDropRule(dropMetrics?.drops_by_rule ?? {});
    const survivorCount = slot.products.length;
    const preLiftCount = params.preLiftSurvivorCounts.get(slot.slot_id) ?? 0;
    const preLiftBudgetDrops =
      params.preLiftBudgetDrops.get(slot.slot_id) ?? 0;
    const market = slot.market_prices;

    if (params.liftedSlots.has(slot.slot_id)) {
      hasTight = true;
      signals.push({
        slot_id: slot.slot_id,
        signal: "lifted",
        evidence: {
          padded_max: slotAlloc?.padded_max,
          survivors: survivorCount,
          market_prices: market,
        },
      });
    }

    if (
      slotAlloc &&
      market &&
      slotAlloc.padded_max < market.min_viable &&
      !params.liftedSlots.has(slot.slot_id)
    ) {
      hasInfeasible = true;
      signals.push({
        slot_id: slot.slot_id,
        signal: "infeasible_market",
        evidence: {
          padded_max: slotAlloc.padded_max,
          min_viable: market.min_viable,
          p10: market.p10,
          sample_size: market.sample_size,
        },
      });
      continue;
    }

    if (survivorCount === 0 && dominant === "budget") {
      hasInfeasible = true;
      signals.push({
        slot_id: slot.slot_id,
        signal: "budget_drops_dominant",
        evidence: { survivors: 0, budget_drops: budgetDrops },
      });
      continue;
    }

    const p10 = market?.p10 ?? percentile(survivorPrices(slot.products), 0.1);

    if (
      slotAlloc &&
      p10 != null &&
      slotAlloc.padded_max < p10 &&
      !params.liftedSlots.has(slot.slot_id)
    ) {
      hasTight = true;
      signals.push({
        slot_id: slot.slot_id,
        signal: "below_p10",
        evidence: {
          padded_max: slotAlloc.padded_max,
          p10,
          source: market ? "market_prices" : "survivors",
          survivors: survivorCount,
        },
      });
    }

    // Secondary count-based signals (unreliable alone under junk-fill).
    if (
      survivorCount < THIN_SLOT_THRESHOLD &&
      dominant === "budget" &&
      budgetDrops > 0 &&
      !params.liftedSlots.has(slot.slot_id) &&
      !market
    ) {
      hasTight = true;
      signals.push({
        slot_id: slot.slot_id,
        signal: "budget_drops_dominant",
        evidence: { budget_drops: budgetDrops, survivors: survivorCount },
      });
    }

    const rawBeforeFilter = preLiftCount + preLiftBudgetDrops;
    if (
      survivorCount < THIN_SLOT_THRESHOLD &&
      rawBeforeFilter >= THIN_SLOT_THRESHOLD &&
      preLiftBudgetDrops > 0 &&
      !params.liftedSlots.has(slot.slot_id) &&
      !market
    ) {
      hasTight = true;
      signals.push({
        slot_id: slot.slot_id,
        signal: "thin_only_with_filter",
        evidence: {
          survivors: survivorCount,
          raw_before_filter: rawBeforeFilter,
          budget_drops: preLiftBudgetDrops,
        },
      });
    }
  }

  const assembly = params.allocation.budget_assembly;
  let hasOversized = false;

  if (assembly && params.slots.length > 0) {
    const p90BySlot = params.slots.map((s) => {
      if (s.market_prices?.p90 != null) return s.market_prices.p90;
      const prices = survivorPrices(s.products);
      return percentile(prices, 0.9) ?? 0;
    });
    const composedP90 = p90BySlot.reduce((n, p) => n + p, 0);
    const allHavePrices = p90BySlot.every((p) => p > 0);

    if (
      allHavePrices &&
      assembly.total_max > composedP90 * 1.15 &&
      composedP90 > 0
    ) {
      hasOversized = true;
      signals.push({
        slot_id: "_overall",
        signal: "headroom_above_p90",
        evidence: {
          stated_total: assembly.total_max,
          composed_p90: composedP90,
          ceiling: assembly.total_max * (1 + BUDGET_ASSEMBLY_TOLERANCE),
        },
      });
    }
  }

  let severity: BudgetTensionSeverity = "none";
  if (hasInfeasible) severity = "infeasible";
  else if (hasTight) severity = "tight";
  else if (hasOversized) severity = "oversized";

  return { severity, slots: signals };
}
