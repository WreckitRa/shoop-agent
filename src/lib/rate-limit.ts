/**
 * Lightweight in-process rate limiter for Next.js middleware.
 *
 * This is a per-instance bucket implementation. For multi-replica deploys,
 * replace the `RateLimitStore` backing with a Redis/Upstash implementation
 * while keeping the same `checkRateLimit` interface.
 *
 * Buckets are evicted on a 60s schedule so the Map never grows unboundedly.
 */

type Bucket = { count: number; resetAt: number };

class RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private scheduleCleanup() {
    if (this.cleanupTimer !== null) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }, 60_000);
    // Allow the process to exit even if the timer is pending.
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      (this.cleanupTimer as { unref(): void }).unref();
    }
  }

  check(key: string, maxRequests: number, windowMs: number): { ok: true } | { ok: false; retryAfter: number } {
    this.scheduleCleanup();
    const now = Date.now();
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }

    if (current.count >= maxRequests) {
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    return { ok: true };
  }
}

const store = new RateLimitStore();

export type RateLimitRule = {
  /** IP key prefix for namespacing rules in the shared store. */
  namespace: string;
  maxRequests: number;
  windowMs: number;
};

/** Well-known rate limit tiers. */
export const RATE_LIMIT_TIERS = {
  /** Auth mutations (login, signup, logout, guest) — strict. */
  auth: { namespace: "auth", maxRequests: 10, windowMs: 60_000 },
  /** Chat stream — already has its own gate, this is the middleware layer. */
  chat: { namespace: "chat", maxRequests: 25, windowMs: 60_000 },
  /** Cart mutations and checkout. */
  cart: { namespace: "cart", maxRequests: 60, windowMs: 60_000 },
  /** Profile / memory / onboarding reads and writes. */
  profile: { namespace: "profile", maxRequests: 120, windowMs: 60_000 },
  /** General API fallback. */
  general: { namespace: "general", maxRequests: 200, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Check whether a request should be rate-limited.
 *
 * @param req  The incoming request (supports both `Request` and Next.js `NextRequest`).
 * @param rule  The rate limit rule to apply.
 */
export function checkRateLimit(
  req: { headers: { get(name: string): string | null } },
  rule: RateLimitRule,
): { ok: true } | { ok: false; retryAfter: number } {
  const key = `${rule.namespace}:${clientIp(req)}`;
  return store.check(key, rule.maxRequests, rule.windowMs);
}
