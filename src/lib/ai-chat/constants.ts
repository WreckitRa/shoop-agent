import type { ResponseStyle } from "./types";

/** V1 default user scope until auth exists */
export const AI_CHAT_DEFAULT_USER_ID = "local-dev-user";

export const NEW_CHAT_TITLE = "New chat";

/** Main chat replies — Opus 4.8 for verdict-first rack narration after search. Override via conversation settings. */
export const AI_CHAT_DEFAULT_MODEL =
  process.env.AI_CHAT_DEFAULT_MODEL?.trim() || "claude-opus-4-8";

/**
 * Structured profile extraction used by onboarding (`onboarding/memory-extract`),
 * used by onboarding profile extraction.
 * Haiku default — the extraction prompt uses concrete schema + few-shot examples
 * so Haiku reliably produces valid JSON at significantly lower cost and latency.
 * Override to Sonnet via AI_CHAT_MEMORY_MODEL when extraction quality degrades.
 */
export const AI_CHAT_MEMORY_MODEL =
  process.env.AI_CHAT_MEMORY_MODEL?.trim() || "claude-haiku-4-5-20251001";

/**
 * Haiku for cheap aux work: suggested placeholders, titles, summaries,
 * memory/topic JSON classifiers. Single knob for all low-cost calls.
 */
export const AI_CHAT_LIGHTWEIGHT_MODEL =
  process.env.AI_CHAT_LIGHTWEIGHT_MODEL?.trim() || "claude-haiku-4-5-20251001";

export const ALLOWED_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022",
  "claude-haiku-4-5-20251001",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
] as const;

export type AllowedModelId = (typeof ALLOWED_MODELS)[number];

export function isAllowedModel(model: string): model is AllowedModelId {
  return (ALLOWED_MODELS as readonly string[]).includes(model);
}

/**
 * Opus 4.7+ and Sonnet 5 reject non-default temperature/top_p/top_k (400).
 * Omit `temperature` on these models and let the API use its default.
 */
const MODELS_WITHOUT_CUSTOM_TEMPERATURE = new Set<string>([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
]);

export function supportsCustomTemperature(model: string): boolean {
  return !MODELS_WITHOUT_CUSTOM_TEMPERATURE.has(model);
}

/** Returns temperature for the Messages API, or undefined when the model forbids overrides. */
export function anthropicTemperatureForModel(
  model: string,
  temperature: number,
): number | undefined {
  return supportsCustomTemperature(model) ? temperature : undefined;
}

export const RECENT_MESSAGES_LIMIT = 20;

/** Maximum messages returned by `GET /api/conversations/:id` — keep reload cost bounded. */
export const CONVERSATION_PAGE_MESSAGE_LIMIT = 200;

/** Heartbeat interval for SSE keepalive comments (15s — well under proxy idle timeouts). */
export const SSE_HEARTBEAT_MS = 15_000;

export const MAX_USER_MESSAGE_LENGTH = 24_000;

export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 1;

export const MAX_OUTPUT_TOKENS_MIN = 256;
export const MAX_OUTPUT_TOKENS_MAX = 4096;

/** Defaults applied when a conversation has no per-conversation overrides yet. */
export const DEFAULT_UI_SETTINGS = {
  model: AI_CHAT_DEFAULT_MODEL,
  temperature: 0.7,
  maxTokens: 4096,
  responseStyle: "balanced" as ResponseStyle,
  systemPrompt: "",
};
