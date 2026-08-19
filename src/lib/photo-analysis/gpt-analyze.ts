import { parseLlmJsonObject } from "@/lib/ai-chat/llm-json";
import { jpegForGpt } from "./decode";
import {
  PHOTO_ERROR,
  publicPhotoError,
  publicPhotoErrorFromHttp,
  retryWaitMs,
} from "./errors";
import { buildGptPhotoAnalysisPrompt } from "./gpt-prompt";
import { coercePhotoProfile } from "./schema";
import type { PhotoProfile } from "./types";

/** Fast default. Set OPENAI_PHOTO_ANALYSIS_MODEL=gpt-5.4-pro for a deeper pass later. */
export const DEFAULT_GPT_PHOTO_MODEL = "gpt-5.4";
const GPT_TIMEOUT_MS = 90_000;
const GPT_MAX_OUTPUT_TOKENS = 4096;

let gptLock: Promise<void> = Promise.resolve();

function withGptLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = gptLock.then(fn, fn);
  gptLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function photoAnalysisGptModel(): string {
  const override = process.env.OPENAI_PHOTO_ANALYSIS_MODEL?.trim();
  return override || DEFAULT_GPT_PHOTO_MODEL;
}

function outputText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  if (typeof o.output_text === "string" && o.output_text.trim()) {
    return o.output_text;
  }
  if (!Array.isArray(o.output)) return "";
  const chunks: string[] = [];
  for (const item of o.output) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      type?: string;
      content?: unknown;
      text?: string;
    };
    if (typeof rec.text === "string") chunks.push(rec.text);
    if (!Array.isArray(rec.content)) continue;
    for (const block of rec.content) {
      if (!block || typeof block !== "object") continue;
      const part = block as {
        type?: string;
        text?: string;
        refusal?: string;
      };
      if (typeof part.text === "string") chunks.push(part.text);
      if (typeof part.refusal === "string") chunks.push(part.refusal);
    }
  }
  return chunks.join("\n");
}

async function postResponses(
  apiKey: string,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
}

async function analyzeGptUnlocked(bytes: Buffer): Promise<PhotoProfile> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = photoAnalysisGptModel();
  const jpeg = await jpegForGpt(bytes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GPT_TIMEOUT_MS);
  const body = JSON.stringify({
    model,
    reasoning: { effort: "low" },
    max_output_tokens: GPT_MAX_OUTPUT_TOKENS,
    text: { format: { type: "json_object" } },
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildGptPhotoAnalysisPrompt() },
          {
            type: "input_image",
            image_url: `data:${jpeg.mime};base64,${jpeg.base64}`,
            detail: "auto",
          },
        ],
      },
    ],
  });

  let res: Response;
  let payload: unknown = null;
  try {
    res = await postResponses(apiKey, body, controller.signal);
    payload = await res.json().catch(() => null);
    let retries = 0;
    while (res.status === 429 && retries < 3 && !controller.signal.aborted) {
      retries += 1;
      await new Promise((r) => setTimeout(r, retryWaitMs(res, payload)));
      if (controller.signal.aborted) break;
      res = await postResponses(apiKey, body, controller.signal);
      payload = await res.json().catch(() => null);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(PHOTO_ERROR.timeout);
    }
    const raw = error instanceof Error ? error.message : PHOTO_ERROR.failed;
    throw new Error(publicPhotoError(raw) ?? PHOTO_ERROR.failed);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(publicPhotoErrorFromHttp(res.status, payload));
  }

  const text = outputText(payload);
  const parsed = parseLlmJsonObject(text);
  if (!parsed) {
    throw new Error(text.trim() ? PHOTO_ERROR.non_json : PHOTO_ERROR.empty);
  }
  return coercePhotoProfile(parsed.value, model);
}

export async function analyzeGptFromBytes(bytes: Buffer): Promise<PhotoProfile> {
  return withGptLock(() => analyzeGptUnlocked(bytes));
}
