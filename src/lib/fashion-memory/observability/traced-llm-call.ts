import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { anthropicTemperatureForModel } from "@/lib/ai-chat/constants";
import { logAiChat } from "@/lib/ai-chat/observability";
import { fashionMemoryDb } from "../db";
import { hashSystemPrompt, upsertPromptVersion } from "./prompt-hash";
import { recordPromptCacheUsage } from "./prompt-cache-metrics";
import { recordTurnLlmCall } from "./search-observability";

export type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

/**
 * Build Anthropic system content with an ephemeral cache breakpoint on the
 * STATIC prefix. Variable user data must go in `uncachedSuffix` (or messages).
 */
export function buildCachedSystemBlocks(params: {
  cachedPrefix: string;
  uncachedSuffix?: string;
}): AnthropicSystemBlock[] {
  const blocks: AnthropicSystemBlock[] = [
    {
      type: "text",
      text: params.cachedPrefix,
      cache_control: { type: "ephemeral" },
    },
  ];
  const suffix = params.uncachedSuffix?.trim();
  if (suffix) {
    blocks.push({ type: "text", text: suffix });
  }
  return blocks;
}

export type TracedLlmCallParams = {
  traceId?: string | null;
  stage: string;
  model: string;
  /**
   * Full system text for hashing/audit. Prefer also passing
   * `systemCachedPrefix` (+ optional uncached suffix) so Anthropic can cache.
   */
  systemPrompt: string;
  /** Static prefix — marked cache_control ephemeral. Must NOT contain user PII. */
  systemCachedPrefix?: string;
  /** Dynamic suffix (ROSTER/PROFILES/DATE, voice tint, …) — never cached. */
  systemUncachedSuffix?: string;
  /** When true, send system as a plain string with no cache_control. */
  disablePromptCache?: boolean;
  inputMessages: MessageCreateParamsNonStreaming["messages"];
  tools?: MessageCreateParamsNonStreaming["tools"];
  toolChoice?: MessageCreateParamsNonStreaming["tool_choice"];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  createMessage?: typeof createLightweightMessage;
};

export type TracedLlmExecuteResult<T> = {
  value: T;
  rawOutput: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
};

function isTraceId(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

type UsageLike = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

function readCacheUsage(usage: UsageLike | undefined | null): {
  cacheRead: number | null;
  cacheCreation: number | null;
} {
  if (!usage) return { cacheRead: null, cacheCreation: null };
  return {
    cacheRead:
      typeof usage.cache_read_input_tokens === "number"
        ? usage.cache_read_input_tokens
        : null,
    cacheCreation:
      typeof usage.cache_creation_input_tokens === "number"
        ? usage.cache_creation_input_tokens
        : null,
  };
}

function persistLlmCall(params: {
  traceId: string;
  stage: string;
  model: string;
  systemPromptHash: string;
  inputMessages: unknown;
  toolChoice: unknown;
  rawOutput: unknown;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string;
}): void {
  void fashionMemoryDb()
    .from("llm_calls")
    .insert({
      trace_id: params.traceId,
      stage: params.stage,
      model: params.model,
      system_prompt_hash: params.systemPromptHash,
      input_messages: params.inputMessages,
      tool_choice: params.toolChoice ?? null,
      raw_output: params.rawOutput,
      latency_ms: params.latencyMs,
      input_tokens: params.inputTokens ?? null,
      output_tokens: params.outputTokens ?? null,
      error: params.error ?? null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        logAiChat("warn", "fashion_llm_call_persist_failed", {
          traceId: params.traceId,
          stage: params.stage,
          error: error.message,
        });
      }
    });
}

/**
 * Shared audit choke-point for fashion LLM calls (Anthropic, OpenAI, stream).
 * Hashes system prompt, upserts prompt_versions, persists llm_calls.
 */
export async function withTracedLlmCall<T>(params: {
  traceId?: string | null;
  stage: string;
  model: string;
  systemPrompt: string;
  inputMessages: unknown;
  toolChoice?: unknown;
  execute: () => Promise<TracedLlmExecuteResult<T>>;
}): Promise<T> {
  const systemPromptHash = hashSystemPrompt(params.systemPrompt);
  upsertPromptVersion({
    hash: systemPromptHash,
    stage: params.stage,
    content: params.systemPrompt,
  });

  const started = Date.now();
  try {
    const {
      value,
      rawOutput,
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    } = await params.execute();
    recordPromptCacheUsage({
      stage: params.stage,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      inputTokens,
    });
    if (
      cacheReadInputTokens != null ||
      cacheCreationInputTokens != null
    ) {
      logAiChat("info", "fashion_prompt_cache_usage", {
        traceId: params.traceId,
        stage: params.stage,
        cache_read_input_tokens: cacheReadInputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
        input_tokens: inputTokens,
      });
    }
    if (isTraceId(params.traceId)) {
      recordTurnLlmCall(params.traceId, {
        stage: params.stage,
        model: params.model,
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        cacheReadInputTokens,
        cacheCreationInputTokens,
      });
      persistLlmCall({
        traceId: params.traceId,
        stage: params.stage,
        model: params.model,
        systemPromptHash,
        inputMessages: params.inputMessages,
        toolChoice: params.toolChoice ?? null,
        rawOutput,
        latencyMs: Date.now() - started,
        inputTokens,
        outputTokens,
      });
    }
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTraceId(params.traceId)) {
      persistLlmCall({
        traceId: params.traceId,
        stage: params.stage,
        model: params.model,
        systemPromptHash,
        inputMessages: params.inputMessages,
        toolChoice: params.toolChoice ?? null,
        rawOutput: { error: message },
        latencyMs: Date.now() - started,
        error: message,
      });
    }
    throw error;
  }
}

/**
 * Wraps createLightweightMessage with verbatim input/output audit to llm_calls.
 * Observability writes are fire-and-forget; failures never throw to callers.
 *
 * Prompt caching: pass `systemCachedPrefix` (static rules) and optional
 * `systemUncachedSuffix` (ROSTER/PROFILES/DATE). When only `systemPrompt` is
 * set, the whole system string is cached as one ephemeral block (safe for
 * stages whose system has no per-user data — planner, normalize, extraction).
 */
export async function tracedLLMCall(
  params: TracedLlmCallParams,
): Promise<Message> {
  const createMessage = params.createMessage ?? createLightweightMessage;

  // Opus 4.7+ / Sonnet 5 reject `temperature` (400 invalid_request_error).
  const temperature = anthropicTemperatureForModel(
    params.model,
    params.temperature ?? 0.2,
  );

  const cachedPrefix =
    params.systemCachedPrefix?.trim() || params.systemPrompt;
  const uncachedSuffix = params.systemCachedPrefix
    ? params.systemUncachedSuffix
    : undefined;
  const system: MessageCreateParamsNonStreaming["system"] =
    params.disablePromptCache
      ? params.systemPrompt
      : buildCachedSystemBlocks({
          cachedPrefix,
          uncachedSuffix,
        });

  const request: MessageCreateParamsNonStreaming = {
    model: params.model,
    max_tokens: params.maxTokens ?? 2048,
    ...(temperature !== undefined ? { temperature } : {}),
    system,
    messages: params.inputMessages,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
  };

  return withTracedLlmCall({
    traceId: params.traceId,
    stage: params.stage,
    model: params.model,
    systemPrompt: params.systemPrompt,
    inputMessages: params.inputMessages,
    toolChoice: params.toolChoice ?? null,
    execute: async () => {
      const response = await createMessage(request, { signal: params.signal });
      const usage = response.usage as UsageLike | undefined;
      const { cacheRead, cacheCreation } = readCacheUsage(usage);
      return {
        value: response,
        rawOutput: response,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        cacheReadInputTokens: cacheRead,
        cacheCreationInputTokens: cacheCreation,
      };
    },
  });
}
