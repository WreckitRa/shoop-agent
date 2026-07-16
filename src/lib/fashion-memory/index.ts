export { fashionMemoryDb, FashionMemoryError } from "./db";
export {
  ensureSelfPerson,
  createPerson,
  resolvePerson,
  resolvePersonIdRef,
  getPersonById,
  listPeopleForUser,
} from "./people";
export {
  extractMentionedRelations,
  ensureMentionedPeople,
  ensureMentionedPeopleLocal,
} from "./people-from-mentions";
export { upsertFashionFact, listActiveFashionFacts } from "./facts";
export {
  logRequestEvent,
  upsertStyleSignal,
  listActiveStyleSignals,
  supersedeStyleSignal,
  normalizeSignalValue,
} from "./signals";
export {
  beginExtractionRun,
  finishExtractionRun,
  getDoneExtractionWatermark,
  getLatestDoneExtractionRun,
  hasRecentRunningExtraction,
} from "./extraction-runs";
export {
  runFashionExtraction,
} from "./extraction/runner";
export {
  spawnDetachedFashionExtraction,
  spawnDetachedFashionExtractionSweep,
} from "./extraction/spawn";
export { sweepFashionExtractionForConversation } from "./extraction/sweep";
export {
  assembleExtractionContext,
  buildExtractionContextFromData,
  type FashionExtractionContext,
} from "./extraction/assemble-context";
export { buildFashionExtractionPrompt } from "./extraction/prompt";
export { applyFashionOps } from "./extraction/apply-ops";
export { extractFashionMemoryFromTurn } from "./extraction/llm-extract";
export {
  effectiveSignalConfidence,
  filterSignalsByEffectiveConfidence,
  signalAboveEffectiveThreshold,
} from "./signal-confidence";
export { runRequestEventCorroboration } from "./extraction/corroboration";
export {
  writeFashionPickAcceptance,
  writeFashionPickRejection,
} from "./direct-writes";
export { isSupabaseAuthUserId, isFashionMemoryGuestUserId } from "./auth";
export { migrateGuestFashionMemoryToUser } from "./migrate-guest";
export {
  assembleRouterContext,
  writeRequestEventFromBrief,
} from "./router/assemble-router-context";
export { buildFashionRouterPrompt } from "./router/prompt";
export { runFashionRouter, FALLBACK_CLARIFICATION } from "./router/llm-router";
export type {
  FashionRouterContext,
  FashionRouterResult,
  FashionSearchBrief,
  MessageFashionRouterMetaV1,
} from "./router/types";
export {
  planSearchFromBrief,
  fashionSearchPlanToMetadata,
  buildFallbackPlan,
  resolveFashionSearchPlan,
} from "./search-planner/plan-from-brief";
export { buildSearchPlannerPrompt } from "./search-planner/prompt";
export { runSearchPlanner } from "./search-planner/llm-planner";
export { clampFashionSearchPlan, validateAndRepairSlotVariants } from "./search-planner/clamps";
export {
  repairSlotQueryVariants,
  validateSlotQueryVariants,
  buildDeterministicQueryVariants,
  extractStyleDescriptors,
} from "./search-planner/query-builder";
export type {
  FashionSearchPlan,
  FashionSearchPlanSlot,
  MessageFashionSearchPlanMetaV1,
  PlanSource,
} from "./search-planner/types";
export {
  DEPARTMENT_QUERY_WORDS,
  TARGET_GENDER_FILTER_VALUES,
  departmentFromRelation,
  ensureDepartmentQueryPrefix,
  resolveDepartmentEvidence,
  resolveSearchDepartment,
} from "./department";
export type {
  FashionDepartment,
  PersonDepartment,
  ProductGenderTarget,
} from "./department";
export { coercePersonDepartment, PERSON_DEPARTMENTS } from "./department";
export {
  loadFashionSearchProfile,
  searchCatalogForSlot,
  searchFashionCatalogPlan,
  postProcessFashionCatalogSlots,
  fashionCatalogSearchToMetadata,
  catalogSummaryToProductCard,
  buildSlotCatalogFilters,
  composeSlotIntentString,
  taxonomyCategoriesForGarment,
} from "./catalog-search";
export type {
  FashionCatalogSearchResult,
  FashionSearchProfile,
  FashionSlotCatalogResult,
  MessageFashionCatalogSearchMetaV1,
} from "./catalog-search";
export {
  normalizeCatalogSearchSlots,
  resolveColorDeterministic,
  resolveSizeDeterministic,
  preNormalize,
} from "./normalize";
export type {
  ColorBucket,
  NormalizedSize,
  ProductNormalization,
  NormalizeMetrics,
} from "./normalize";
export {
  applyHardDrops,
  applyHardDropsForSlots,
  parseMaterialMentions,
} from "./hard-drops";
export type {
  HardDropRule,
  HardDroppedProduct,
  ProductSuspicion,
  SurvivorProduct,
} from "./hard-drops";
export {
  scoreCatalogSlots,
  scoreSlotProducts,
  scoreProduct,
} from "./scoring";
export type { ProductScore, ScoringMetrics } from "./scoring";
export {
  runFashionCuration,
  buildPresentationContract,
  validateCurationOutput,
} from "./curation";
export {
  loadGuestFashionMemorySnapshot,
  loadGuestFashionStore,
  readGuestFashionMemoryForUser,
  persistGuestFashionRequestEvent,
} from "./client/guest-bridge";
export {
  recordFashionPickSelection,
  recordFashionPickRejection,
} from "./client/pick-signals";
export type { GuestFashionMemorySnapshot } from "./local/store";
export type { FashionMemoryDelta } from "./local/apply-delta";
export type * from "./types";
