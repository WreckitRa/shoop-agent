/**
 * Curation deliverable + image budgets.
 * single_item < outfit < capsule for image spend.
 */

/** Hero picks shown in UI for single/multi item. */
export const CURATION_HERO_PICKS = 3;

/** Named looks / capsule rotations the curator must form. */
export const CURATION_LOOKS_TARGET = 3;

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
  mode: "single_item" | "outfit" | "capsule" | "multi_item";
  optionsWanted: number;
}): number {
  if (params.mode === "single_item" || params.mode === "multi_item") {
    return CURATION_HERO_PICKS;
  }
  // Outfit / capsule: still surface slot picks for the look grid, but
  // the primary deliverable is 3 looks / capsule outfits.
  return Math.min(8, Math.max(1, params.optionsWanted));
}
