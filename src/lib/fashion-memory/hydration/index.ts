export {
  HYDRATION_BENCH_MULTIPLIER,
  HYDRATION_CALL_TIMEOUT_MS,
  HYDRATION_DEFAULT_OVERFLOW,
  HYDRATION_MAX_CONCURRENCY,
  HYDRATION_MAX_INITIAL_WAVE,
  HYDRATION_TIMEOUT_RETRIES,
  HYDRATION_TRANSIENT_RETRIES,
  hydrationInitialWaveSize,
  hydrationTargetCount,
} from "./config";
export { createConcurrencyGate } from "./concurrency-gate";
export type { ConcurrencyGate } from "./concurrency-gate";
export {
  VERIFY_TTL_HOURS,
  POOL_WORKING_LIFECYCLE_DAYS,
} from "./pool-lifecycle-config";
export {
  loadSlotPool,
  saveSlotPool,
  persistAllSlotPools,
  type SearchPoolState,
  type RehydratedSlotPool,
} from "./pool-persistence";
export { isHydrationStale, reverifyCandidate } from "./verify-staleness";
export {
  buildSizeSelection,
  hasPartiallyUnknownSizes,
  isSizeSelectionFallback,
  recipientExcludedByOfferedSizes,
  relaxationOrder,
  sizeOptionAvailability,
} from "./build-size-selection";
export { hydrateCandidate } from "./hydrate-candidate";
export {
  tryUnambiguousSizeConversion,
  normalizedSizeMatchesField,
  isAmbiguousDressNumericMapping,
} from "./size-conversion";
export { createSlotPool } from "./pool";
export {
  hydrateCatalogSlots,
  hydrateFashionCatalogResult,
} from "./orchestrator";
export type {
  HydratedCandidate,
  HydrationDeathCause,
  HydrationDeathRecord,
  HydrationMetrics,
  OverflowItem,
  ScoredProduct,
  SizeStatus,
  SlotPool,
} from "./types";
