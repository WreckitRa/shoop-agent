import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { getAnthropicApiKey } from "./env";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "./constants";
import {
  recordLightweightPromptRun,
  type LightweightPromptAudit,
} from "./prompt-run/lightweight-audit";

let client: Anthropic | null = null;

const LIGHTWEIGHT_RETRY_DELAYS_MS = [400, 1200];

export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getAnthropicApiKey() });
  }
  return client;
}

function isRetryableAnthropicError(err: unknown): boolean {
  const text = String(err).toLowerCase();
  return (
    text.includes("529") ||
    text.includes("overloaded_error") ||
    text.includes("rate_limit")
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Cheap Haiku calls for placeholders, titles, summaries, and JSON classifiers. */
export async function createLightweightMessage(
  params: Omit<MessageCreateParamsNonStreaming, "model"> & {
    model?: MessageCreateParamsNonStreaming["model"];
  },
  requestOptions?: {
    signal?: AbortSignal;
    audit?: LightweightPromptAudit;
  },
): Promise<Message> {
  const anthropic = getAnthropicClient();
  const body: MessageCreateParamsNonStreaming = {
    ...params,
    model: params.model ?? AI_CHAT_LIGHTWEIGHT_MODEL,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= LIGHTWEIGHT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const msg = await anthropic.messages.create(body, {
        signal: requestOptions?.signal,
      });
      if (requestOptions?.audit) {
        recordLightweightPromptRun(body, msg, requestOptions.audit);
      }
      return msg;
    } catch (err) {
      if (requestOptions?.signal?.aborted) throw err;
      lastError = err;
      if (
        attempt >= LIGHTWEIGHT_RETRY_DELAYS_MS.length ||
        !isRetryableAnthropicError(err)
      ) {
        throw err;
      }
      await sleep(LIGHTWEIGHT_RETRY_DELAYS_MS[attempt]!, requestOptions?.signal);
    }
  }

  throw lastError;
}
