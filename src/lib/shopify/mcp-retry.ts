/**
 * HTTP statuses worth retrying: rate limiting (429) and transient
 * gateway/backend failures (500/502/503/504). The Global Catalog MCP surfaces
 * upstream outages as `502 upstream connect error` and `504`, so those must be
 * retried alongside 503. @see scripts/ping-catalog-mcp.ts
 */
export const RETRYABLE_MCP_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Retry wrapper for Shopify MCP `fetch` calls.
 *
 * Handles 429 (rate limited) and transient gateway/backend errors
 * (500/502/503/504) with exponential backoff + jitter. Other HTTP errors and
 * network failures are not retried because they're unlikely to be transient.
 *
 * @param fn  A function that returns a fetch `Response`. Called on each attempt.
 * @param maxRetries  Maximum number of retry attempts after the first failure (default 3).
 * @param signal  Optional AbortSignal — if aborted, retries stop immediately.
 */
export async function withMcpRetry(
  fn: () => Promise<Response>,
  maxRetries = 3,
  signal?: AbortSignal,
): Promise<Response> {
  const RETRYABLE_STATUSES = RETRYABLE_MCP_STATUSES;
  const BASE_DELAY_MS = 200;

  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException("MCP request aborted", "AbortError");
    }

    const res = await fn();

    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      return res;
    }

    // Honor Retry-After header when present (value is seconds).
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader
      ? parseFloat(retryAfterHeader) * 1000
      : undefined;

    const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * BASE_DELAY_MS;
    const delayMs = retryAfterMs ?? Math.min(exponential + jitter, 10_000);

    attempt++;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("MCP request aborted", "AbortError"));
      }, { once: true });
    });
  }
}

/**
 * True when a thrown MCP error looks like a *transient backend blip* that a
 * retry could recover — as opposed to a bad request, auth, or config error.
 *
 * The Global Catalog MCP returns these on HTTP 200 with a JSON-RPC error body
 * (so {@link withMcpRetry}'s status check can't see them), e.g.
 * `{"code":-32000,"message":"Service error. Please try again later."}`.
 */
export function isTransientMcpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/-32000/.test(msg) && /try again later/i.test(msg)) return true;
  if (/service error\.?\s*please try again later/i.test(msg)) return true;
  return false;
}

/**
 * Retry `fn` when it throws a transient JSON-RPC error ({@link isTransientMcpError}).
 * Pairs with {@link withMcpRetry} (which handles transient *HTTP* statuses) to
 * cover backend blips that arrive as HTTP 200 + error body. Aborts immediately
 * when `signal` fires.
 */
export async function retryTransientMcp<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; signal?: AbortSignal },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const BASE_DELAY_MS = 250;
  let attempt = 0;
  while (true) {
    if (opts?.signal?.aborted) {
      throw new DOMException("MCP request aborted", "AbortError");
    }
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isTransientMcpError(err) || opts?.signal?.aborted) {
        throw err;
      }
      const delayMs = Math.min(
        BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS,
        5_000,
      );
      attempt++;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        opts?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("MCP request aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
  }
}
