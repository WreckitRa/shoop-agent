export { FASHION_CURATION_MODEL } from "../models";

/**
 * Thinking + tool JSON share this budget. Adaptive thinking at high effort
 * can burn most of a small cap and truncate deliver_curation — keep headroom.
 */
export const FASHION_CURATION_MAX_TOKENS = 32_000;

/** Soft guidance for Opus 4.8 adaptive thinking — medium leaves room for the tool call. */
export const FASHION_CURATION_EFFORT = "medium" as const;

/**
 * Hard wall-clock cap for a single curation LLM call. On timeout → failed
 * attempt (harvest partial vetoes if parseable) → fallback. Never unbounded.
 */
export const CURATION_LLM_TIMEOUT_MS = 60_000;

/** /health tripwire when p90 curation_ms exceeds this. */
export const CURATION_LATENCY_TRIPWIRE_MS = 90_000;

/**
 * Max edge for curator product photos. Anthropic many-image requests reject
 * any dimension > 2000px — stay well under via Shopify CDN width params.
 */
export const CURATION_IMAGE_MAX_PX = 768;

/** Image budget per mode (top-scored candidates get image blocks). */
export const CURATION_IMAGE_BUDGET = {
  single_item: 12,
  anchor_slot: 10,
  support_slot: 6,
} as const;

export const CURATION_UNVERIFIED_OVERFLOW = 10;

export const CURATION_VETO_TRIPWIRE_RATIO = 0.2;

export const CURATION_TOOL_NAME = "deliver_curation";
