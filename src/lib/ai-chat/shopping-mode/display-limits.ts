import type { CuratedPick, CurationSlot, ProductCard } from "../types";
import type { ShoppingMode } from "./types";

const FEATURED_SLOT_ORDER: CurationSlot[] = [
  "shoop_pick",
  "best_value",
  "most_popular",
];

/**
 * Max products surfaced in the chat UI for one catalog search.
 * Three named slots (horizontal row) + gallery row share this cap.
 */
export const PRODUCT_DISPLAY_LIMIT_BY_MODE: Record<ShoppingMode, number> = {
  judge: 100,
  copilot: 100,
  hybrid: 100,
  directional: 100,
};

export function productDisplayLimitForMode(mode: ShoppingMode): number {
  return PRODUCT_DISPLAY_LIMIT_BY_MODE[mode];
}

/** Catalog cards to fetch for a search — matches what the UI can show. */
export function catalogCardLimitForMode(mode: ShoppingMode): number {
  return productDisplayLimitForMode(mode);
}

export const MAX_PRODUCT_DISPLAY_LIMIT = Math.max(
  ...Object.values(PRODUCT_DISPLAY_LIMIT_BY_MODE),
);

export const FEATURED_CURATION_SLOTS = FEATURED_SLOT_ORDER;

/** Visual order for the three featured square cards (hero centered). */
export const FEATURED_ROW_SLOT_ORDER: CurationSlot[] = [
  "best_value",
  "shoop_pick",
  "most_popular",
];

export function orderFeaturedPicksForRow(
  featured: CuratedPick[],
): CuratedPick[] {
  return FEATURED_ROW_SLOT_ORDER.map((slot) =>
    featured.find((p) => p.slot === slot),
  ).filter((p): p is CuratedPick => Boolean(p));
}

export type CuratedDisplayPartition = {
  /** Best value / Most popular / Shoop's pick — horizontal square row. */
  featured: CuratedPick[];
  /** Additional picks with verdict + reason — horizontal gallery row. */
  gallery: CuratedPick[];
  /** Catalog candidates returned for this search but not rendered. */
  omittedCount: number;
};

export function partitionCuratedPicksForDisplay(
  _products: ProductCard[],
  curatedPicks: CuratedPick[] | undefined,
  displayLimit: number,
): CuratedDisplayPartition {
  const picks = curatedPicks ?? [];
  const featured = FEATURED_CURATION_SLOTS.map((slot) =>
    picks.find((p) => p.slot === slot),
  ).filter((p): p is CuratedPick => Boolean(p));

  // The gem / loosened / reframed slots render alongside the gallery row.
  const GALLERY_SLOTS: ReadonlySet<CurationSlot> = new Set([
    "gallery",
    "gem",
    "loosened",
    "reframed",
  ]);
  const maxGallery = Math.max(0, displayLimit - featured.length);
  const gallery = picks
    .filter((p) => GALLERY_SLOTS.has(p.slot))
    .slice(0, maxGallery);

  const shownIds = new Set([
    ...featured.map((p) => p.id),
    ...gallery.map((p) => p.id),
  ]);
  /** Curated picks hidden only by the per-mode display cap — not the verify pool. */
  const omittedCount = picks.filter((p) => !shownIds.has(p.id)).length;

  return { featured, gallery, omittedCount };
}
