export { FASHION_CURATION_MODEL } from "../models";

/**
 * Thinking + tool JSON share this budget. Adaptive thinking at high effort
 * can burn most of a small cap and truncate deliver_curation — keep headroom.
 */
export const FASHION_CURATION_MAX_TOKENS = 32_000;

/** Soft guidance for Opus 4.8 adaptive thinking — medium leaves room for the tool call. */
export const FASHION_CURATION_EFFORT = "medium" as const;

/**
 * Hard wall-clock cap for a single curation LLM call. 0 = disabled (collect
 * samples via fashion_curation_llm_timing logs / health before setting a limit).
 */
export const CURATION_LLM_TIMEOUT_MS = Number(
  process.env.CURATION_LLM_TIMEOUT_MS ?? "0",
);

/** /health tripwire when p90 curation_ms exceeds this. */
export const CURATION_LATENCY_TRIPWIRE_MS = 90_000;

/**
 * Max edge for curator product photos. Anthropic many-image requests reject
 * any dimension > 2000px — stay well under via Shopify CDN width params.
 */
export const CURATION_IMAGE_MAX_PX = 768;

export {
  CURATION_IMAGE_BUDGET,
  CURATION_HERO_PICKS,
  CURATION_LOOKS_TARGET,
  CURATION_VERIFIED_BENCH,
  CURATION_UNVERIFIED_OVERFLOW,
  imageBudgetForSlot,
  curationPickCap,
} from "./deliverables";

export const CURATION_VETO_TRIPWIRE_RATIO = 0.2;

export const CURATION_TOOL_NAME = "deliver_curation";
