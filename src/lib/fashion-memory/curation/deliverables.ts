/**
 * Curation deliverable + image budgets.
 * single_item < outfit < capsule for image spend.
 */

import { agreedDepth, DEPTH_CEILING } from "../agreed-depth";
import type { FashionSearchBrief } from "../router/types";
import type { SearchPlanMode } from "../search-planner/types";

/** Absolute pick ceiling — not a target. */
export const CURATION_PICKS_CEILING = DEPTH_CEILING;
/** Absolute looks ceiling — not a target. */
export const CURATION_LOOKS_CEILING = DEPTH_CEILING;

/** Verified bench under the heroes (per garment). */
export const CURATION_VERIFIED_BENCH = 10;

/** Unverified scored-but-not-hydrated tail (per garment). */
export const CURATION_UNVERIFIED_OVERFLOW = 10;

/**
 * How many product images to attach for the curator LLM call.
 * Phase 0: scorer already ranked — trust it; images only for visual veto/pick.
 * Bench + overflow remain text refs only (image_shown=false beyond budget).
 */
export const CURATION_IMAGE_BUDGET = {
  /** Single / multi — top 6 imaged. */
  single_item: 6,
  /** Outfit — top 4 per slot. */
  outfit_anchor: 4,
  outfit_support: 4,
  /** Capsule — still lean; previously 22–28. */
  capsule_anchor: 6,
  capsule_support: 4,
} as const;

export function imageBudgetForSlot(params: {
  mode: "single_item" | "outfit" | "capsule" | "multi_item";
  role: "anchor" | "support";
}): number {
  if (params.mode === "single_item" || params.mode === "multi_item") {
    return CURATION_IMAGE_BUDGET.single_item;
  }
  if (params.mode === "capsule") {
    return params.role === "anchor"
      ? CURATION_IMAGE_BUDGET.capsule_anchor
      : CURATION_IMAGE_BUDGET.capsule_support;
  }
  return params.role === "anchor"
    ? CURATION_IMAGE_BUDGET.outfit_anchor
    : CURATION_IMAGE_BUDGET.outfit_support;
}

/** Cap of picks the curator should deliver for a slot (UI heroes). */
export function curationPickCap(params: {
  mode: SearchPlanMode;
  brief: FashionSearchBrief;
  optionsWanted?: number;
}): number {
  const { picks } = agreedDepth(params.brief);
  const want =
    params.mode === "single_item" || params.mode === "multi_item"
      ? picks
      : (params.optionsWanted ?? picks);
  return Math.min(Math.max(1, want), CURATION_PICKS_CEILING);
}

export function curationLooksTarget(brief: FashionSearchBrief): number {
  return Math.min(agreedDepth(brief).looks, CURATION_LOOKS_CEILING);
}
