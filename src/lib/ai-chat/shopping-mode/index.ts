export {
  isShoppingMode,
  isShoppingModeSelection,
  SHOPPING_MODES,
  SHOPPING_MODE_SELECTIONS,
  SHOPPING_MODE_LABEL,
  SHOPPING_MODE_HINT,
} from "./types";
export type {
  ShoppingMode,
  ShoppingModeSelection,
  ShoppingModeResolved,
  ShoppingModeSource,
} from "./types";
export { detectShoppingMode } from "./detector";
export type { DetectionInput, DetectionResult } from "./detector";
export { shoppingModeSystemAddendum } from "./prompts";
export {
  detectContextExpertise,
  getContextExpertiseByTag,
  contextExpertiseSystemBlock,
} from "./context-expertise";
export type { ContextExpertise } from "./context-expertise";
export {
  PRODUCT_DISPLAY_LIMIT_BY_MODE,
  MAX_PRODUCT_DISPLAY_LIMIT,
  FEATURED_CURATION_SLOTS,
  FEATURED_ROW_SLOT_ORDER,
  productDisplayLimitForMode,
  catalogCardLimitForMode,
  partitionCuratedPicksForDisplay,
  orderFeaturedPicksForRow,
} from "./display-limits";
export type { CuratedDisplayPartition } from "./display-limits";
