/**
 * Outfit grid public API — in-house catalog only (no Shopify / vision).
 * Implementation: outfit-grid-inhouse.ts + outfit-style-catalog.ts
 */

export type {
  OutfitDeckContext,
  OutfitDeckPage,
  OutfitGridCard,
} from "./outfit-grid-inhouse";
export {
  OUTFIT_DECK_PAGE_SIZE,
  buildOutfitGridDeck,
  countInhouseCoverage,
  genderBucketFromPresentation,
  lookVariantGroup,
  scoreLookForContext,
  selectInhouseDeck,
  uniqueOutfitCards,
} from "./outfit-grid-inhouse";

export type {
  CastingArchetype,
  CastingCell,
  OutfitGridMode,
  OutfitGridSlot,
} from "./outfit-grid-matrix";
