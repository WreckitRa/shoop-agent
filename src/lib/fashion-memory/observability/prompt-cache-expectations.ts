/**
 * Per-stage prompt-cache expectations vs Anthropic minimums.
 * Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 * (Cache limitations — verified 2026-07-30).
 *
 * DO NOT pad static prompts to chase cache hits. Under-threshold stages
 * correctly show expected_cacheable=false / hit_rate n/a on /health.
 */

export type PromptCacheStageExpectation = {
  /** Configured model class for this stage. */
  model: string;
  /** Anthropic minimum cacheable prefix tokens for that model. */
  min_cacheable_tokens: number;
  /**
   * Approx static-prefix tokens (chars/3.5). Tools add more at request time
   * but the SYSTEM static string is what we control.
   */
  static_prefix_tokens_approx: number;
  /** Whether the static system prefix alone clears the minimum. */
  expected_cacheable: boolean;
  why: string;
};

/**
 * Haiku 4.5 → 4096. Sonnet 5 / Sonnet 4.6 → 1024.
 * (Opus 4.5/4.6 → 4096; Opus 5 → 512 — not used for these stages.)
 */
export const PROMPT_CACHE_STAGE_EXPECTATIONS: Record<
  string,
  PromptCacheStageExpectation
> = {
  router: {
    model: "claude-sonnet-5 (FASHION_ROUTER_MODEL)",
    min_cacheable_tokens: 1024,
    static_prefix_tokens_approx: 4866,
    expected_cacheable: true,
    why: "ROUTER_PROMPT_STATIC clears Sonnet 5's 1024-token floor; turn-1 writes, turn-2+ should read.",
  },
  planner: {
    model: "claude-haiku-4-5 (FASHION_SEARCH_PLANNER_MODEL)",
    min_cacheable_tokens: 4096,
    static_prefix_tokens_approx: 1713,
    expected_cacheable: false,
    why: "SEARCH_PLANNER_PROMPT ~1.7k tokens — under Haiku 4.5 minimum. Marker present; Anthropic silently skips cache. Do not pad.",
  },
  normalize_llm: {
    model: "claude-haiku-4-5 (FASHION_NORMALIZE_MODEL)",
    min_cacheable_tokens: 4096,
    static_prefix_tokens_approx: 391,
    expected_cacheable: false,
    why: "CLASSIFY_LABELS_SYSTEM_PROMPT is tiny. Cache marker is ornamental; zeros are expected.",
  },
  extraction: {
    model: "claude-haiku-4-5 (FASHION_EXTRACTOR_MODEL)",
    min_cacheable_tokens: 4096,
    static_prefix_tokens_approx: 1877,
    expected_cacheable: false,
    why: "Extraction system prompt ~1.9k — under Haiku 4.5 floor. Do not pad.",
  },
  curation: {
    model: "claude-sonnet-5 (FASHION_CURATION_MODEL)",
    min_cacheable_tokens: 1024,
    static_prefix_tokens_approx: 1502,
    expected_cacheable: true,
    why: "CURATION_PROMPT_SKELETON clears Sonnet 5's 1024-token floor (plus tools).",
  },
  curation_voice: {
    model: "claude-haiku-4-5 (FASHION_CURATION_VOICE_MODEL)",
    min_cacheable_tokens: 4096,
    static_prefix_tokens_approx: 153,
    expected_cacheable: false,
    why: "VOICE_SYSTEM ~150 tokens. Prompt cache disabled on Stage B; zeros are n/a not broken.",
  },
};

export function expectationForStage(
  stage: string,
): PromptCacheStageExpectation | undefined {
  if (PROMPT_CACHE_STAGE_EXPECTATIONS[stage]) {
    return PROMPT_CACHE_STAGE_EXPECTATIONS[stage];
  }
  // router_escalation etc.
  if (stage.startsWith("router")) return PROMPT_CACHE_STAGE_EXPECTATIONS.router;
  if (stage.startsWith("planner")) return PROMPT_CACHE_STAGE_EXPECTATIONS.planner;
  if (stage.startsWith("normalize")) {
    return PROMPT_CACHE_STAGE_EXPECTATIONS.normalize_llm;
  }
  if (stage.startsWith("curation_voice")) {
    return PROMPT_CACHE_STAGE_EXPECTATIONS.curation_voice;
  }
  if (stage.startsWith("curation")) return PROMPT_CACHE_STAGE_EXPECTATIONS.curation;
  if (stage.startsWith("extraction")) {
    return PROMPT_CACHE_STAGE_EXPECTATIONS.extraction;
  }
  return undefined;
}
