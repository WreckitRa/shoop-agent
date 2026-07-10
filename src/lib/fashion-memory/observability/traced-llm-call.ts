import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { logAiChat } from "@/lib/ai-chat/observability";
import { fashionMemoryDb } from "../db";
import { hashSystemPrompt, upsertPromptVersion } from "./prompt-hash";

export type TracedLlmCallParams = {
  traceId?: string | null;
  stage: string;
  model: string;
  systemPrompt: string;
  inputMessages: MessageCreateParamsNonStreaming["messages"];
  tools?: MessageCreateParamsNonStreaming["tools"];
  toolChoice?: MessageCreateParamsNonStreaming["tool_choice"];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  createMessage?: typeof createLightweightMessage;
};

function isTraceId(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
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
 * Wraps createLightweightMessage with verbatim input/output audit to llm_calls.
 * Observability writes are fire-and-forget; failures never throw to callers.
 */
export async function tracedLLMCall(
  params: TracedLlmCallParams,
): Promise<Message> {
  const createMessage = params.createMessage ?? createLightweightMessage;
  const systemPromptHash = hashSystemPrompt(params.systemPrompt);
  upsertPromptVersion({
    hash: systemPromptHash,
    stage: params.stage,
    content: params.systemPrompt,
  });

  const request: MessageCreateParamsNonStreaming = {
    model: params.model,
    max_tokens: params.maxTokens ?? 2048,
    temperature: params.temperature ?? 0.2,
    system: params.systemPrompt,
    messages: params.inputMessages,
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
  };

  const started = Date.now();
  try {
    const response = await createMessage(request, { signal: params.signal });
    const latencyMs = Date.now() - started;

    if (isTraceId(params.traceId)) {
      persistLlmCall({
        traceId: params.traceId,
        stage: params.stage,
        model: params.model,
        systemPromptHash,
        inputMessages: params.inputMessages,
        toolChoice: params.toolChoice ?? null,
        rawOutput: response,
        latencyMs,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      });
    }

    return response;
  } catch (error) {
    const latencyMs = Date.now() - started;
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
        latencyMs,
        error: message,
      });
    }

    throw error;
  }
}
