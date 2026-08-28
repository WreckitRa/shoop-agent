/**
 * Curation deliverable + image budgets.
 * single_item < outfit < capsule for image spend.
 */

import { isTasteScoringEnabled } from "../scoring/weights";
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
 * Bench + overflow remain text refs only (image_shown=false beyond budget).
 * v4: anchor / single-item min(8, agreedDepth × 2). Support stays 4.
 * v3 (pre-S1): fixed 6 / 4 / 6.
 */
export const CURATION_IMAGE_BUDGET = {
  support: 4,
  cap: 8,
} as const;

const CURATION_IMAGE_BUDGET_V3 = {
  support: 4,
  single: 6,
  outfit_anchor: 4,
  capsule_anchor: 6,
} as const;

export function imageBudgetForSlot(params: {
  mode: "single_item" | "outfit" | "capsule" | "multi_item";
  role: "anchor" | "support";
  brief?: Pick<FashionSearchBrief, "request_type" | "depth">;
}): number {
  if (!isTasteScoringEnabled()) {
    if (
      params.role === "support" &&
      params.mode !== "single_item" &&
      params.mode !== "multi_item"
    ) {
      return CURATION_IMAGE_BUDGET_V3.support;
    }
    if (params.mode === "outfit") return CURATION_IMAGE_BUDGET_V3.outfit_anchor;
    if (params.mode === "capsule") return CURATION_IMAGE_BUDGET_V3.capsule_anchor;
    return CURATION_IMAGE_BUDGET_V3.single;
  }
  if (
    params.role === "support" &&
    params.mode !== "single_item" &&
    params.mode !== "multi_item"
  ) {
    return CURATION_IMAGE_BUDGET.support;
  }
  const depth = params.brief ? agreedDepth(params.brief).picks : 3;
  return Math.min(CURATION_IMAGE_BUDGET.cap, depth * 2);
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
