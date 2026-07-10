export * from "./types";
export * from "./weights";
export { paletteMatch, paletteComponentScore } from "./palette-match";
export {
  scoreShopifyRank,
  scoreCorroboration,
  scoreSizeConfirmed,
  scoreRating,
  scoreDepartmentConfirmed,
  scoreProduct,
  renormalizedWeights,
  isSizeComponentActive,
  isPaletteComponentActive,
  isDepartmentComponentActive,
} from "./components";
export { scoreSlotProducts, scoreCatalogSlots } from "./orchestrator";
