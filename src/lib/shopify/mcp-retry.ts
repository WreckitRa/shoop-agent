/**
 * HTTP statuses worth retrying: rate limiting (429) and transient
 * gateway/backend failures (500/502/503/504). The Global Catalog MCP surfaces
 * upstream outages as `502 upstream connect error` and `504`, so those must be
 * retried alongside 503. @see scripts/ping-catalog-mcp.ts
 */
export const RETRYABLE_MCP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryableMcpNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return /fetch failed|econnreset|etimedout|econnrefused|socket|und_err|other side closed|network/i.test(
    `${msg} ${cause}`,
  );
}

async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("MCP request aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("MCP request aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Retry wrapper for Shopify MCP `fetch` calls.
 *
 * Handles 429 (rate limited), transient gateway/backend errors
 * (500/502/503/504), and dropped connections (ECONNRESET / fetch failed).
 */
export async function withMcpRetry(
  fn: () => Promise<Response>,
  maxRetries = 3,
  signal?: AbortSignal,
): Promise<Response> {
  const BASE_DELAY_MS = 200;

  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException("MCP request aborted", "AbortError");
    }

    try {
      const res = await fn();

      if (!RETRYABLE_MCP_STATUSES.has(res.status) || attempt >= maxRetries) {
        return res;
      }

      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader
        ? parseFloat(retryAfterHeader) * 1000
        : undefined;

      const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * BASE_DELAY_MS;
      const delayMs = retryAfterMs ?? Math.min(exponential + jitter, 10_000);

      attempt++;
      await sleepAbortable(delayMs, signal);
    } catch (err) {
      if (
        attempt >= maxRetries ||
        !isRetryableMcpNetworkError(err) ||
        signal?.aborted
      ) {
        throw err;
      }
      const delayMs = Math.min(
        BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS,
        10_000,
      );
      attempt++;
      await sleepAbortable(delayMs, signal);
    }
  }
}

/**
 * True when a thrown MCP error looks like a *transient backend blip* that a
 * retry could recover — as opposed to a bad request, auth, or config error.
 *
 * The Global Catalog MCP returns these on HTTP 200 with a JSON-RPC error body
 * (so {@link withMcpRetry}'s status check can't see them), e.g.
 * `{"code":-32000,"message":"Service error. Please try again later."}`
 * or `{"code":-32600,"message":"Invalid Request","data":"Rate limit exceeded"}`.
 */
export function isRateLimitMcpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit/i.test(msg);
}

export function isTransientMcpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (isRateLimitMcpError(err)) return true;
  if (isRetryableMcpNetworkError(err)) return true;
  if (/-32000/.test(msg) && /try again later/i.test(msg)) return true;
  if (/service error\.?\s*please try again later/i.test(msg)) return true;
  return false;
}

function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const n = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        active += 1;
        fn().then(resolve, reject).finally(() => {
          active -= 1;
          queue.shift()?.();
        });
      };
      if (active < n) start();
      else queue.push(start);
    });
  };
}

/** Cap parallel Global Catalog MCP calls so looks/chat don't stampede into 429. */
const catalogMcpLimit = pLimit(3);

export function withCatalogMcpLimit<T>(fn: () => Promise<T>): Promise<T> {
  return catalogMcpLimit(fn);
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
  let maxRetries = opts?.maxRetries ?? 2;
  let attempt = 0;
  while (true) {
    if (opts?.signal?.aborted) {
      throw new DOMException("MCP request aborted", "AbortError");
    }
    try {
      return await fn();
    } catch (err) {
      if (opts?.maxRetries == null && isRateLimitMcpError(err)) {
        maxRetries = 5;
      }
      if (attempt >= maxRetries || !isTransientMcpError(err) || opts?.signal?.aborted) {
        throw err;
      }
      const rateLimited = isRateLimitMcpError(err);
      const base = rateLimited ? 1_500 : 250;
      const cap = rateLimited ? 12_000 : 5_000;
      const delayMs = Math.min(
        base * Math.pow(2, attempt) + Math.random() * base,
        cap,
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
