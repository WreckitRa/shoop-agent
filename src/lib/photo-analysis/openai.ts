import { parseLlmJsonObject } from "@/lib/ai-chat/llm-json";
import {
  PHOTO_ERROR,
  publicPhotoError,
  publicPhotoErrorFromHttp,
  retryWaitMs,
} from "./errors";

let gptLock: Promise<void> = Promise.resolve();

export function withPhotoGptLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = gptLock.then(fn, fn);
  gptLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function photoGptOutputText(data: unknown): string {
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
      content?: unknown;
      text?: string;
    };
    if (typeof rec.text === "string") chunks.push(rec.text);
    if (!Array.isArray(rec.content)) continue;
    for (const block of rec.content) {
      if (!block || typeof block !== "object") continue;
      const part = block as { text?: string; refusal?: string };
      if (typeof part.text === "string") chunks.push(part.text);
      if (typeof part.refusal === "string") chunks.push(part.refusal);
    }
  }
  return chunks.join("\n");
}

export async function postPhotoResponses(
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

export async function postPhotoResponsesWithRetry(
  apiKey: string,
  body: string,
  signal: AbortSignal,
): Promise<{ res: Response; payload: unknown }> {
  let res = await postPhotoResponses(apiKey, body, signal);
  let payload: unknown = await res.json().catch(() => null);
  let retries = 0;
  while (res.status === 429 && retries < 3 && !signal.aborted) {
    retries += 1;
    await new Promise((r) => setTimeout(r, retryWaitMs(res, payload)));
    if (signal.aborted) break;
    res = await postPhotoResponses(apiKey, body, signal);
    payload = await res.json().catch(() => null);
  }
  return { res, payload };
}

export type PhotoJsonSchemaCall = {
  model: string;
  reasoning: { effort: "none" | "low" | "medium" | "high" };
  instructions: string;
  userContent: Array<
    | { type: "input_text"; text: string }
    | {
        type: "input_image";
        image_url: string;
        detail: "low" | "original" | "auto";
      }
  >;
  format: {
    name: string;
    description: string;
    schema: unknown;
  };
  maxOutputTokens: number;
  timeoutMs: number;
  safetyIdentifier?: string;
};

export async function callPhotoJsonSchema(
  opts: PhotoJsonSchemaCall,
): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const body = JSON.stringify({
    model: opts.model,
    reasoning: opts.reasoning,
    instructions: opts.instructions,
    input: [
      {
        role: "user",
        content: opts.userContent,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: opts.format.name,
        description: opts.format.description,
        strict: true,
        schema: opts.format.schema,
      },
    },
    max_output_tokens: opts.maxOutputTokens,
    store: false,
    ...(opts.safetyIdentifier
      ? { safety_identifier: opts.safetyIdentifier }
      : {}),
  });

  let res: Response;
  let payload: unknown = null;
  try {
    const out = await postPhotoResponsesWithRetry(
      apiKey,
      body,
      controller.signal,
    );
    res = out.res;
    payload = out.payload;
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
  if (
    payload &&
    typeof payload === "object" &&
    (payload as { status?: string }).status === "incomplete"
  ) {
    throw new Error(PHOTO_ERROR.incomplete);
  }

  const text = photoGptOutputText(payload);
  if (!text.trim()) {
    throw new Error(PHOTO_ERROR.empty);
  }
  const parsed = parseLlmJsonObject(text);
  if (!parsed) {
    throw new Error(PHOTO_ERROR.non_json);
  }
  return parsed.value;
}
