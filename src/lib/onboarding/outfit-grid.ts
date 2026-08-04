/**
 * Outfit grid public API — in-house catalog only (no Shopify / vision).
 * Implementation: outfit-grid-inhouse.ts + outfit-style-catalog.ts
 */

export type {
  OutfitDeckContext,
  OutfitGridCard,
} from "./outfit-grid-inhouse";
export {
  buildOutfitGridDeck,
  countInhouseCoverage,
  genderBucketFromPresentation,
  scoreLookForContext,
  selectInhouseDeck,
} from "./outfit-grid-inhouse";

export type {
  CastingArchetype,
  CastingCell,
  OutfitGridMode,
  OutfitGridSlot,
} from "./outfit-grid-matrix";
