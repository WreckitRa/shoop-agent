import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { randomUUID } from "node:crypto";
import type { TracedLlmCallParams } from "@/lib/fashion-memory/observability/traced-llm-call";
import type { E2eMode, LlmRecording } from "../types";

export function toolMessage(
  toolName: string,
  input: Record<string, unknown>,
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
): Message {
  return {
    id: `msg_mock_${randomUUID().slice(0, 8)}`,
    type: "message",
    role: "assistant",
    model: "mock",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      ...(usage?.cache_read_input_tokens != null
        ? { cache_read_input_tokens: usage.cache_read_input_tokens }
        : {}),
      ...(usage?.cache_creation_input_tokens != null
        ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
        : {}),
    },
    content: [
      {
        type: "tool_use",
        id: `toolu_mock_${randomUUID().slice(0, 8)}`,
        name: toolName,
        input,
      },
    ],
  } as Message;
}

type RecordingBuckets = {
  router?: LlmRecording[];
  planner?: LlmRecording[];
  extraction?: LlmRecording[];
  curation?: LlmRecording[];
};

function bucketForStage(stage: string): keyof RecordingBuckets {
  if (stage.startsWith("router")) return "router";
  if (stage.startsWith("planner")) return "planner";
  if (stage === "brand_translate" || stage.startsWith("normalize")) return "extraction";
  if (stage.startsWith("curation")) return "curation";
  return "router";
}

export type LlmCallCounter = {
  byStage: Record<string, number>;
  total: number;
  /** Per router call: cache_read_input_tokens (simulates Anthropic turn-2+ reads). */
  routerCacheReads: number[];
};

export function createLlmMock(
  mode: E2eMode,
  recordings: RecordingBuckets,
  counter?: LlmCallCounter,
): (params: TracedLlmCallParams) => Promise<import("@anthropic-ai/sdk/resources/messages/messages").Message> {
  const indices: Record<string, number> = {};

  return async (params) => {
    if (counter) {
      counter.byStage[params.stage] = (counter.byStage[params.stage] ?? 0) + 1;
      counter.total += 1;
    }

    const bucket = bucketForStage(params.stage);
    const list = recordings[bucket] ?? [];

    if (mode === "live") {
      const { tracedLLMCall } = await import(
        "@/lib/fashion-memory/observability/traced-llm-call"
      );
      return tracedLLMCall(params);
    }

    const key = `${bucket}:${params.stage}`;
    const idx = indices[key] ?? 0;
    indices[key] = idx + 1;

    const rec = list[idx] ?? list[list.length - 1];
    if (!rec) {
      throw new Error(`No LLM recording for stage=${params.stage} bucket=${bucket} idx=${idx}`);
    }

    // Simulate Anthropic prompt-cache: turn 1 writes, turn 2+ reads for router.
    const isRouter = params.stage === "router" || params.stage.startsWith("router");
    const routerOrdinal = isRouter
      ? (counter?.byStage[params.stage] ?? 1)
      : 0;
    const usage = isRouter
      ? routerOrdinal <= 1
        ? {
            input_tokens: 6500,
            output_tokens: 200,
            cache_creation_input_tokens: 6300,
            cache_read_input_tokens: 0,
          }
        : {
            input_tokens: 6500,
            output_tokens: 200,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 6300,
          }
      : undefined;

    if (isRouter && counter) {
      counter.routerCacheReads.push(usage?.cache_read_input_tokens ?? 0);
    }

    return toolMessage(rec.toolName, rec.input, usage);
  };
}

export function createEmptyLlmCounter(): LlmCallCounter {
  return { byStage: {}, total: 0, routerCacheReads: [] };
}
