import { getAnalyticsSessionId } from "@/lib/analytics/session-client";
import { ANALYTICS_SESSION_HEADER } from "@/lib/analytics/constants";
import { useAppSessionStore } from "@/lib/client/app-session";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import { postFittingTraceEvent } from "@/components/onboarding/fitting/fitting-trace-log";
import {
  getFittingTraceId,
  isFittingTracePublicEnabled,
  summarizeFittingTraceBody,
} from "@/components/onboarding/fitting/fitting-trace-id";
import { FITTING_TRACE_HEADER } from "@/lib/onboarding/fitting-trace-shared";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function shouldTraceFittingUrl(url: string): boolean {
  return /\/api\/(onboarding|tryon|avatar)(\/|\?|$)/.test(url);
}

function shouldLogFittingFetch(url: string): boolean {
  if (!isFittingTracePublicEnabled() || !getFittingTraceId()) return false;
  if (url.includes("/api/onboarding/fitting-trace")) return false;
  return shouldTraceFittingUrl(url);
}

/** Adds analytics session + guest session headers when applicable. */
export function guestFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const analyticsSessionId = getAnalyticsSessionId();
  if (analyticsSessionId) {
    headers.set(ANALYTICS_SESSION_HEADER, analyticsSessionId);
  }

  const guestId = getGuestSessionId();
  const mode = useAppSessionStore.getState().mode;
  if (guestId && mode !== "authenticated") {
    headers.set("X-Guest-Session-Id", guestId);
  }

  const url = requestUrl(input);
  const traceId = getFittingTraceId();
  if (
    isFittingTracePublicEnabled() &&
    traceId &&
    shouldTraceFittingUrl(url)
  ) {
    headers.set(FITTING_TRACE_HEADER, traceId);
  }

  if (!shouldLogFittingFetch(url)) {
    return fetch(input, { ...init, headers });
  }

  const started = Date.now();
  const method = (init?.method ?? "GET").toUpperCase();
  return fetch(input, { ...init, headers }).then(
    (res) => {
      postFittingTraceEvent("http.fetch", {
        method,
        url,
        status: res.status,
        ms: Date.now() - started,
        body: summarizeFittingTraceBody(init?.body ?? null),
      });
      return res;
    },
    (error: unknown) => {
      postFittingTraceEvent("http.fetch_error", {
        method,
        url,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "fetch failed",
      });
      throw error;
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for Retry-After (seconds) or exponential backoff, capped. */
export function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("Retry-After");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1000), 30_000);
  }
  return Math.min(1000 * 2 ** attempt, 8_000);
}

export function isRateLimitedResponse(
  res: Response,
  bodyError?: string | null,
): boolean {
  if (res.status === 429) return true;
  return /too many requests/i.test(bodyError ?? "");
}

/**
 * guestFetch that retries 429s using Retry-After (or backoff).
 * Other statuses return immediately.
 */
export async function guestFetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const res = await guestFetch(input, init);
    if (res.status !== 429 || attempt >= maxRetries) return res;
    await sleep(retryAfterMs(res, attempt));
    attempt += 1;
  }
}
