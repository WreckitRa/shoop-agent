export type {
  CurationNarration,
  CurationLook,
  CapsuleOutfit,
  DeliverCurationInput,
  DeliverCurationPick,
  DeliverCurationSlot,
  DeliverCurationVeto,
  FashionCurationPresentation,
  FashionCurationResult,
  FashionCuratedPick,
  FashionVerifiedTierItem,
  FashionUnverifiedTierItem,
  MessageFashionCurationMetaV1,
  PickRole,
  CuratorVetoReason,
  RunFashionCurationParams,
  RefEntry,
  CurationRefRegistry,
} from "./types";

export {
  FASHION_CURATION_MODEL,
  CURATION_TOOL_NAME,
  CURATION_IMAGE_BUDGET,
  CURATION_LLM_TIMEOUT_MS,
  CURATION_LATENCY_TRIPWIRE_MS,
} from "./config";

export { buildCurationInput } from "./build-input";
export { buildCurationSystemPrompt, CURATION_PROMPT_SKELETON } from "./prompt";
export {
  parseDeliverCurationInput,
  extractDeliverCurationBlock,
  extractDeliverCurationBlockDetailed,
  harvestVetoesFromToolContent,
  coerceDeliverCurationInput,
  DELIVER_CURATION_TOOL,
} from "./tool-schema";
export {
  validateCurationOutput,
  nearIdenticalPickWarning,
  fillEmptySlotPicks,
} from "./validate";
export { buildDeterministicFallback } from "./fallback";
export { buildPresentationContract } from "./presentation";
export { buildRefRegistry, refToProductId, refsForSlot } from "./refs";
export { runFashionCuration } from "./run-curation";
export {
  sanitizeCurationNarration,
  NARRATION_MACHINERY_RE,
} from "./narration-sanitize";
export {
  recordCurationLatencyMs,
  curationLatencySnapshot,
} from "./latency-metrics";
export {
  promotePick,
  rejectPick,
  writePromoteSignals,
  writeRejectSignal,
  collectExcludedRefs,
} from "./picks-actions";
