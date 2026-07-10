import type { CatalogSearchFilters } from "@/lib/shopify/catalog";
import {
  resolveSearchDepartment,
  TARGET_GENDER_FILTER_VALUES,
} from "../department";
import type { FashionSearchBrief } from "../router/types";
import type { SearchPlanMode } from "../search-planner/types";
import type { ResolvedBudgetAllocation } from "../budget/budgetAllocation";
import { priceBoundsForSlot } from "../budget/budgetAllocation";
import type { FashionSearchProfile } from "./types";
import { taxonomyCategoriesForGarment } from "./garment-taxonomy";

export type SlotFilterOptions = {
  /** When true, omit taxonomy category filter (thin-slot reformulation / Lane A). */
  omitCategory?: boolean;
  /**
   * When true, omit Target gender attribute filter (unfiltered hedge lane).
   * Category-filtered lanes may carry Target gender; the open lane must not.
   */
  omitTargetGender?: boolean;
  /**
   * When true, omit server price bound (Lane B price scout).
   * Over-budget hits are measured then budget-dropped client-side.
   * Priced lanes (A/C) send guard_max (padded × RELEVANCE_GUARD_MULTIPLIER),
   * not the enforcement ceiling — hard-drop still uses padded_max.
   */
  omitPrice?: boolean;
};

/**
 * Hard server-side filters for UCP catalog search.
 *
 * NEVER add Color or Size to `filters.attributes` here — merchant free-text
 * fields ("noir", "washed black", "m-38") cause silent inventory loss when
 * filtered server-side. Size/color matching runs client-side after label
 * normalization in the next pipeline stage. Profile no-gos are also excluded.
 *
 * Target gender IS allowed on category-filtered lanes only (Male+Unisex /
 * Female+Unisex). Kids/baby have no server gender filter.
 */
export function buildSlotCatalogFilters(params: {
  brief: FashionSearchBrief;
  profile: FashionSearchProfile;
  garment: string;
  mode?: SearchPlanMode;
  slotId?: string;
  allocation?: ResolvedBudgetAllocation | null;
  liftedMax?: number;
  options?: SlotFilterOptions;
}): CatalogSearchFilters {
  const filters: CatalogSearchFilters = {
    available: true,
    ships_to: { country: params.profile.countryCode.toUpperCase() },
  };

  if (params.brief.budget_context.stated && !params.options?.omitPrice) {
    const price = priceBoundsForSlot({
      brief: params.brief,
      mode: params.mode ?? params.brief.request_type,
      slotId: params.slotId ?? "",
      allocation: params.allocation,
      profileCurrency: params.profile.currency,
      liftedMax: params.liftedMax,
      // Relevance guard — enforcement stays client-side at padded_max.
      purpose: "server_filter",
    });
    if (price) filters.price = price;
  }

  if (!params.options?.omitCategory) {
    const categories = taxonomyCategoriesForGarment(params.garment);
    if (categories.length) filters.categories = categories;
  }

  if (!params.options?.omitCategory && !params.options?.omitTargetGender) {
    const department = resolveSearchDepartment({
      knowledgeDepartment: params.brief.knowledge_state?.department,
      departmentScope: params.brief.department_scope,
    });
    const genderValues = TARGET_GENDER_FILTER_VALUES[department];
    if (genderValues?.length) {
      filters.attributes = [
        { name: "Target gender", values: [...genderValues] },
      ];
    }
  }

  return filters;
}

export { priceBoundsForSlot } from "../budget/budgetAllocation";
