import type { MessageFashionCatalogSearchMetaV1 } from "./types";

export function fashionCatalogHasResults(
  catalogSearch: MessageFashionCatalogSearchMetaV1 | undefined,
): boolean {
  return Boolean(
    catalogSearch?.curation ||
      catalogSearch?.render ||
      catalogSearch?.slots?.some((slot) => (slot.verified_pool?.length ?? 0) > 0),
  );
}

/** Swap the loader for the live rack only after Stage A curation, not the hydration preview. */
export function fashionCatalogReadyToDisplay(
  catalogSearch: MessageFashionCatalogSearchMetaV1 | undefined,
): boolean {
  if (!catalogSearch || catalogSearch.provisional) return false;
  return fashionCatalogHasResults(catalogSearch);
}
