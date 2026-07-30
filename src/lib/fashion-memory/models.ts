import {
  AI_CHAT_DEFAULT_MODEL,
  AI_CHAT_LIGHTWEIGHT_MODEL,
  AI_CHAT_MEMORY_MODEL,
} from "@/lib/ai-chat/constants";

function envModel(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

/** Haiku-class fashion router (intent + clarification). */
export const FASHION_ROUTER_MODEL =
  envModel("FASHION_ROUTER_MODEL") ??
  envModel("FASHION_MEMORY_EXTRACTOR_MODEL") ??
  AI_CHAT_LIGHTWEIGHT_MODEL;

/**
 * Opus-class router escalation — paid only when brief invariants trip
 * (accessories coercion, unknown common family, validation retry).
 * Env: FASHION_ROUTER_ESCALATION_ENABLED=1 (default off).
 */
export const FASHION_ROUTER_ESCALATION_ENABLED =
  process.env.FASHION_ROUTER_ESCALATION_ENABLED === "1" ||
  process.env.FASHION_ROUTER_ESCALATION_ENABLED === "true";

export const FASHION_ROUTER_ESCALATION_MODEL =
  envModel("FASHION_ROUTER_ESCALATION_MODEL") ?? AI_CHAT_DEFAULT_MODEL;

/** Haiku-class search planner (slot fan-out + budget fractions). */
export const FASHION_SEARCH_PLANNER_MODEL =
  envModel("FASHION_SEARCH_PLANNER_MODEL") ??
  envModel("FASHION_ROUTER_MODEL") ??
  envModel("FASHION_MEMORY_EXTRACTOR_MODEL") ??
  AI_CHAT_LIGHTWEIGHT_MODEL;

/** Haiku-class turn extraction into fashion memory ops. */
export const FASHION_EXTRACTOR_MODEL =
  envModel("FASHION_MEMORY_EXTRACTOR_MODEL") ?? AI_CHAT_MEMORY_MODEL;

/** Haiku-class merchant label normalization. */
export const FASHION_NORMALIZE_MODEL =
  envModel("FASHION_NORMALIZE_MODEL") ?? AI_CHAT_LIGHTWEIGHT_MODEL;

/** Haiku-class unavailable-brand style translation. */
export const FASHION_BRAND_TRANSLATE_MODEL =
  envModel("FASHION_BRAND_TRANSLATE_MODEL") ??
  envModel("FASHION_ROUTER_MODEL") ??
  AI_CHAT_LIGHTWEIGHT_MODEL;

/** Sonnet-class visual curation (pick-and-justify). Was Opus — too slow/expensive. */
export const FASHION_CURATION_MODEL =
  envModel("FASHION_CURATION_MODEL") ?? "claude-sonnet-5";

/** Voice / opening prose after picks — Haiku default (never Opus). */
export const FASHION_CURATION_VOICE_MODEL =
  envModel("FASHION_CURATION_VOICE_MODEL") ??
  envModel("FASHION_ROUTER_MODEL") ??
  AI_CHAT_LIGHTWEIGHT_MODEL;
