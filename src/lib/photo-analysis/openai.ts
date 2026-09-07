import { parseLlmJsonObject } from "@/lib/ai-chat/llm-json";
import { logFitting } from "@/lib/onboarding/fitting-trace";
import {
  PHOTO_ERROR,
  publicPhotoError,
  publicPhotoErrorFromHttp,
  retryWaitMs,
} from "./errors";

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
  const delays = [400, 1200];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
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
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const transient =
        /fetch failed|network|econnreset|etimedout|econnrefused|und_err|socket/i.test(
          msg,
        );
      if (attempt >= delays.length || signal.aborted || !transient) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastError;
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
  /** Override the truncated/incomplete public line (verdict vs photo). */
  incompleteError?: string;
};

export type PhotoUsageTokens = {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  reasoning_tokens: number | null;
};

export type PhotoJsonSchemaResult = {
  value: unknown;
  usage: PhotoUsageTokens | null;
};

function asFinite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function photoUsageTokens(payload: unknown): PhotoUsageTokens | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const u = usage as Record<string, unknown>;
  const details =
    u.output_tokens_details &&
    typeof u.output_tokens_details === "object" &&
    !Array.isArray(u.output_tokens_details)
      ? (u.output_tokens_details as Record<string, unknown>)
      : null;
  const out: PhotoUsageTokens = {
    input_tokens: asFinite(u.input_tokens),
    output_tokens: asFinite(u.output_tokens),
    total_tokens: asFinite(u.total_tokens),
    reasoning_tokens: details ? asFinite(details.reasoning_tokens) : null,
  };
  if (
    out.input_tokens == null &&
    out.output_tokens == null &&
    out.total_tokens == null
  ) {
    return null;
  }
  return out;
}

export async function callPhotoJsonSchema(
  opts: PhotoJsonSchemaCall,
): Promise<PhotoJsonSchemaResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const started = Date.now();
  const userText = opts.userContent
    .filter(
      (part): part is { type: "input_text"; text: string } =>
        part.type === "input_text",
    )
    .map((part) => part.text);
  logFitting("prompt.call", {
    provider: "openai",
    format: opts.format.name,
    model: opts.model,
    reasoning: opts.reasoning.effort,
    timeoutMs: opts.timeoutMs,
    maxOutputTokens: opts.maxOutputTokens,
    hasImage: opts.userContent.some((part) => part.type === "input_image"),
    instructions: opts.instructions,
    userText,
  });

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
    logFitting("prompt.error", {
      provider: "openai",
      format: opts.format.name,
      model: opts.model,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : "openai failed",
    });
    if (controller.signal.aborted) {
      throw new Error(PHOTO_ERROR.timeout);
    }
    const raw = error instanceof Error ? error.message : PHOTO_ERROR.failed;
    throw new Error(publicPhotoError(raw) ?? PHOTO_ERROR.failed);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const message = publicPhotoErrorFromHttp(res.status, payload);
    logFitting("prompt.error", {
      provider: "openai",
      format: opts.format.name,
      model: opts.model,
      ms: Date.now() - started,
      http: res.status,
      error: message,
    });
    throw new Error(message);
  }
  if (
    payload &&
    typeof payload === "object" &&
    (payload as { status?: string }).status === "incomplete"
  ) {
    logFitting("prompt.error", {
      provider: "openai",
      format: opts.format.name,
      model: opts.model,
      ms: Date.now() - started,
      error: opts.incompleteError ?? PHOTO_ERROR.incomplete,
      status: (payload as { status?: string }).status,
      incomplete_details:
        (payload as { incomplete_details?: unknown }).incomplete_details ?? null,
      usage: photoUsageTokens(payload),
      text: photoGptOutputText(payload),
    });
    throw new Error(opts.incompleteError ?? PHOTO_ERROR.incomplete);
  }

  const text = photoGptOutputText(payload);
  if (!text.trim()) {
    logFitting("prompt.error", {
      provider: "openai",
      format: opts.format.name,
      model: opts.model,
      ms: Date.now() - started,
      error: PHOTO_ERROR.empty,
    });
    throw new Error(PHOTO_ERROR.empty);
  }
  const parsed = parseLlmJsonObject(text);
  if (!parsed) {
    logFitting("prompt.error", {
      provider: "openai",
      format: opts.format.name,
      model: opts.model,
      ms: Date.now() - started,
      error: PHOTO_ERROR.non_json,
      text,
    });
    throw new Error(PHOTO_ERROR.non_json);
  }
  logFitting("prompt.result", {
    provider: "openai",
    format: opts.format.name,
    model: opts.model,
    ms: Date.now() - started,
    usage: photoUsageTokens(payload),
    value: parsed.value,
  });
  return { value: parsed.value, usage: photoUsageTokens(payload) };
}
