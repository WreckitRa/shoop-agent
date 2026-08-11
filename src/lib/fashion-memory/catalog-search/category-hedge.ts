import type { CatalogSearchFilters } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { SearchPlanMode } from "../search-planner/types";
import type { ResolvedBudgetAllocation } from "../budget/budgetAllocation";
import {
  hasGarmentTaxonomyMapping,
  taxonomyCategoriesForGarment,
} from "./garment-taxonomy";
import { buildSlotCatalogFilters } from "./slot-filters";
import type { FashionSearchProfile } from "./types";

/** Retrieval lane identity — one relaxed filter each when budget is stated. */
export type CatalogLane = "A" | "B" | "C";

export type VariantFilterPlan = {
  query: string;
  filters: CatalogSearchFilters;
  /** True when the taxonomy categories filter was applied for this lane. */
  category_filtered: boolean;
  /** Lane letter for observability + matched_by bookkeeping. */
  lane: CatalogLane;
};

/**
 * Build per-variant catalog filters.
 *
 * When budget is stated and a garment→taxonomy mapping exists (3 lanes):
 * - Lane A (category hedge): no category, Target gender ON, price ON
 * - Lane B (price scout): category ON, NO price bound — measures true market
 * - Lane C (precise): category ON + price ON
 *
 * When no budget is stated, Lane B ≡ Lane C — collapse to A + C (two queries).
 * Without a taxonomy mapping, every lane stays open (no category filter).
 */
export function buildVariantFilterPlans(params: {
  garment: string;
  brief: FashionSearchBrief;
  profile: FashionSearchProfile;
  queries: string[];
  mode?: SearchPlanMode;
  slotId?: string;
  allocation?: ResolvedBudgetAllocation | null;
  liftedMax?: number;
}): VariantFilterPlan[] {
  const filterParams = {
    brief: params.brief,
    profile: params.profile,
    garment: params.garment,
    mode: params.mode,
    slotId: params.slotId,
    allocation: params.allocation,
    liftedMax: params.liftedMax,
  };

  const hasMapping = hasGarmentTaxonomyMapping(params.garment);
  const budgetStated = params.brief.budget_context.stated;
  const queries = params.queries.filter((q) => q.trim().length > 0);
  if (!queries.length) return [];

  const padQuery = (idx: number): string =>
    queries[Math.min(idx, queries.length - 1)]!;

  if (!hasMapping) {
    const openFilters = buildSlotCatalogFilters(filterParams);
    return queries.slice(0, 3).map((query) => ({
      query,
      filters: openFilters,
      category_filtered: false,
      lane: "A" as const,
    }));
  }

  const laneAFilters = buildSlotCatalogFilters({
    ...filterParams,
    // Keep Target gender on Lane A — omitting it is how mens/womens mixes leak.
    options: { omitCategory: true },
  });
  const laneCFilters = buildSlotCatalogFilters(filterParams);

  if (!budgetStated) {
    // Collapse: Lane A + Lane C only (no extra price-scout query).
    const plans: VariantFilterPlan[] = [
      {
        query: padQuery(0),
        filters: laneAFilters,
        category_filtered: false,
        lane: "A",
      },
    ];
    for (let i = 1; i < Math.max(2, Math.min(queries.length, 3)); i++) {
      plans.push({
        query: padQuery(i),
        filters: laneCFilters,
        category_filtered: true,
        lane: "C",
      });
    }
    return plans;
  }

  const laneBFilters = buildSlotCatalogFilters({
    ...filterParams,
    options: { omitPrice: true },
  });

  return [
    {
      query: padQuery(0),
      filters: laneAFilters,
      category_filtered: false,
      lane: "A",
    },
    {
      query: padQuery(1),
      filters: laneBFilters,
      category_filtered: true,
      lane: "B",
    },
    {
      query: padQuery(2),
      filters: laneCFilters,
      category_filtered: true,
      lane: "C",
    },
  ];
}

export function expectedCategoryGidsForGarment(garment: string): string[] {
  return taxonomyCategoriesForGarment(garment);
}
