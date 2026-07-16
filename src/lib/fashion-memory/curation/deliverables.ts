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
 * Capsule is the wardrobe case — largest budget.
 */
export const CURATION_IMAGE_BUDGET = {
  /** Single / multi — enough to find 3 confident wow picks, then stop. */
  single_item: 12,
  /** Outfit — form 3 looks; more images than single. */
  outfit_anchor: 18,
  outfit_support: 14,
  /** Capsule / wardrobe — largest spend to mix a set + 3 rotations. */
  capsule_anchor: 28,
  capsule_support: 22,
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
