/** Rolling Anthropic prompt-cache stats for GET /api/health. */

import {
  expectationForStage,
  PROMPT_CACHE_STAGE_EXPECTATIONS,
  type PromptCacheStageExpectation,
} from "./prompt-cache-expectations";

const MAX_SAMPLES = 400;

type Sample = {
  stage: string;
  cacheRead: number;
  cacheCreation: number;
  inputTokens: number;
  ts: number;
};

const samples: Sample[] = [];

export function recordPromptCacheUsage(params: {
  stage: string;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  inputTokens?: number | null;
}): void {
  samples.push({
    stage: params.stage,
    cacheRead: Math.max(0, params.cacheReadInputTokens ?? 0),
    cacheCreation: Math.max(0, params.cacheCreationInputTokens ?? 0),
    inputTokens: Math.max(0, params.inputTokens ?? 0),
    ts: Date.now(),
  });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export type PromptCacheStageRow = {
  samples: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  input_tokens: number;
  /**
   * Share of input tokens served as cache reads (0–1).
   * null when the stage is under Anthropic's minimum — show as "n/a", not 0%.
   */
  hit_rate: number | null;
  expected_cacheable: boolean;
  min_cacheable_tokens?: number;
  static_prefix_tokens_approx?: number;
  why?: string;
};

export function promptCacheSnapshot(): {
  samples: number;
  by_stage: Record<string, PromptCacheStageRow>;
  overall_hit_rate: number;
  /** Static expectations for stages with no samples yet (docs /health legend). */
  expectations: Record<string, PromptCacheStageExpectation>;
} {
  const byStage: Record<string, PromptCacheStageRow> = {};

  let totalRead = 0;
  let totalInput = 0;

  for (const s of samples) {
    const exp = expectationForStage(s.stage);
    const expectedCacheable = exp?.expected_cacheable ?? true;
    const row = byStage[s.stage] ?? {
      samples: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      input_tokens: 0,
      hit_rate: expectedCacheable ? 0 : null,
      expected_cacheable: expectedCacheable,
      min_cacheable_tokens: exp?.min_cacheable_tokens,
      static_prefix_tokens_approx: exp?.static_prefix_tokens_approx,
      why: exp?.why,
    };
    row.samples += 1;
    row.cache_read_tokens += s.cacheRead;
    row.cache_creation_tokens += s.cacheCreation;
    row.input_tokens += s.inputTokens;
    byStage[s.stage] = row;
    if (expectedCacheable) {
      totalRead += s.cacheRead;
      totalInput += s.inputTokens;
    }
  }

  for (const row of Object.values(byStage)) {
    if (!row.expected_cacheable) {
      row.hit_rate = null;
    } else {
      row.hit_rate =
        row.input_tokens > 0 ? row.cache_read_tokens / row.input_tokens : 0;
    }
  }

  // Surface known stages with zero samples so /health isn't silent.
  for (const [stage, exp] of Object.entries(PROMPT_CACHE_STAGE_EXPECTATIONS)) {
    if (byStage[stage]) continue;
    byStage[stage] = {
      samples: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      input_tokens: 0,
      hit_rate: exp.expected_cacheable ? 0 : null,
      expected_cacheable: exp.expected_cacheable,
      min_cacheable_tokens: exp.min_cacheable_tokens,
      static_prefix_tokens_approx: exp.static_prefix_tokens_approx,
      why: exp.why,
    };
  }

  return {
    samples: samples.length,
    by_stage: byStage,
    overall_hit_rate: totalInput > 0 ? totalRead / totalInput : 0,
    expectations: PROMPT_CACHE_STAGE_EXPECTATIONS,
  };
}

export function resetPromptCacheForTests(): void {
  samples.length = 0;
}
