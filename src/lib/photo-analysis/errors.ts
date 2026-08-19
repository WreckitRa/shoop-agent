/** User-facing photo-analysis errors. Never leak org ids, URLs, or TPM dumps. */

export const PHOTO_ERROR = {
  rate_limited: "OpenAI rate limit — tap re-run in a few seconds.",
  timeout: "GPT timed out — tap re-run.",
  missing_key: "GPT key isn't set, so only the spec read ran.",
  empty: "GPT returned nothing — tap re-run.",
  non_json: "GPT returned unreadable output — tap re-run.",
  incomplete: "GPT ran out of room — tap re-run.",
  failed: "GPT didn't finish — tap re-run.",
} as const;

export type PhotoErrorCode = keyof typeof PHOTO_ERROR;

const ORG_RE = /organization\s+org-[A-Za-z0-9]+/gi;
const URL_RE = /https?:\/\/\S+/gi;
const TPM_RE = /\b(tokens per min|TPM|Used \d+|Requested \d+|Limit \d+)\b/gi;

export function stripProviderSecrets(message: string): string {
  return message
    .replace(ORG_RE, "organization")
    .replace(URL_RE, "")
    .replace(TPM_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyPhotoError(message: string): PhotoErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes("openai_api_key") || lower.includes("isn't set")) {
    return "missing_key";
  }
  if (lower.includes("timed out")) return "timeout";
  if (
    lower.includes("rate limit") ||
    lower.includes("tokens per min") ||
    lower.includes("tpm") ||
    /\b429\b/.test(lower)
  ) {
    return "rate_limited";
  }
  if (lower.includes("incomplete") || lower.includes("max_output_tokens")) {
    return "incomplete";
  }
  if (lower.includes("non-json") || lower.includes("unreadable")) return "non_json";
  if (lower.includes("empty output") || lower.includes("returned nothing")) {
    return "empty";
  }
  return "failed";
}

export function publicPhotoError(message: string | null | undefined): string | null {
  if (!message?.trim()) return null;
  const code = classifyPhotoError(message);
  if (code !== "failed") return PHOTO_ERROR[code];
  const stripped = stripProviderSecrets(message);
  if (!stripped || stripped.toLowerCase().includes("openai")) {
    return PHOTO_ERROR.failed;
  }
  return stripped;
}

export function publicPhotoErrorFromHttp(
  status: number,
  payload: unknown,
): string {
  if (status === 429) return PHOTO_ERROR.rate_limited;
  const raw = payloadErrorMessage(payload);
  if (raw) return publicPhotoError(raw) ?? PHOTO_ERROR.failed;
  if (payload && typeof payload === "object") {
    const reason = (payload as { incomplete_details?: { reason?: string } })
      .incomplete_details?.reason;
    if (typeof reason === "string" && reason.trim()) {
      return publicPhotoError(reason) ?? PHOTO_ERROR.incomplete;
    }
  }
  if (status === 408 || status === 504) return PHOTO_ERROR.timeout;
  return PHOTO_ERROR.failed;
}

export function payloadErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const err = (payload as { error?: { message?: string } }).error;
  return typeof err?.message === "string" && err.message.trim()
    ? err.message
    : null;
}

export function retryWaitMs(res: Response, payload: unknown): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const sec = Number(header);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(25_000, Math.ceil(sec * 1000) + 750);
    }
  }
  const msg = payloadErrorMessage(payload) ?? "";
  const match = msg.match(/try again in ([\d.]+)\s*s/i);
  if (match) {
    return Math.min(25_000, Math.ceil(Number(match[1]) * 1000) + 750);
  }
  return 8_000;
}
