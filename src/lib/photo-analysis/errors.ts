/** User-facing photo-analysis errors. Never leak org ids, URLs, or TPM dumps. */

export const PHOTO_ERROR = {
  rate_limited: "Too many photos just now — try again in a few seconds.",
  timeout: "That took too long — try again.",
  missing_key: "Photo analysis isn’t available right now.",
  empty: "Couldn’t read that photo — try again.",
  non_json: "Couldn’t read that photo — try again.",
  incomplete: "Couldn’t finish reading that photo — try again.",
  verdict_incomplete: "Couldn’t finish writing your verdict — try again.",
  failed: "Couldn’t finish — try again.",
  no_face: "Couldn't find a face in this photo.",
  face_off: "Face is too small or cut off — try a clearer shot.",
  unread: "Couldn't open this as a photo.",
  too_small: "This photo is too small to read.",
  not_person: "Need a photo of you — a real human face, just you.",
  too_large: "That photo is too large — use one under 10 MB.",
  unsupported_type: "Use a JPEG, PNG, or WebP photo.",
  daily_limit: "You've hit today's photo limit — try again tomorrow.",
  spend_cap: "Photo analysis is paused for today.",
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
  for (const code of Object.keys(PHOTO_ERROR) as PhotoErrorCode[]) {
    if (message === PHOTO_ERROR[code]) return code;
  }
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
  if (
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("und_err") ||
    lower.includes("socket")
  ) {
    return "timeout";
  }
  return "failed";
}

export function publicPhotoError(message: string | null | undefined): string | null {
  if (!message?.trim()) return null;
  return PHOTO_ERROR[classifyPhotoError(message)];
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
