/**
 * Server-side key-value cache with optional Upstash Redis REST backend.
 * Falls back to an in-process TTL map when Redis env vars are unset (local dev).
 */

type CacheEntry = { value: string; expiresAt: number };

const memory = new Map<string, CacheEntry>();

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

async function upstashCommand(
  command: (string | number)[],
): Promise<string | null> {
  const base = process.env.UPSTASH_REDIS_REST_URL!.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();
  const res = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: unknown };
  if (typeof data.result === "number") return String(data.result);
  return typeof data.result === "string" ? data.result : null;
}

/** Read a cached string value, or null on miss / expiry / error. */
export async function kvGet(key: string): Promise<string | null> {
  if (upstashConfigured()) {
    try {
      return await upstashCommand(["GET", key]);
    } catch {
      return null;
    }
  }

  pruneMemory();
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

/** Write a string value with TTL in seconds. Best-effort — never throws. */
export async function kvSetex(
  key: string,
  ttlSeconds: number,
  value: string,
): Promise<void> {
  if (ttlSeconds <= 0) return;

  if (upstashConfigured()) {
    try {
      await upstashCommand(["SETEX", key, ttlSeconds, value]);
    } catch {
      /* best-effort */
    }
    return;
  }

  memory.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/** Integer increment with TTL. Returns the value after increment. */
export async function kvIncrBy(
  key: string,
  amount: number,
  ttlSeconds: number,
): Promise<number> {
  const delta = Math.trunc(amount);
  if (delta === 0) {
    const current = Number((await kvGet(key)) ?? 0);
    return Number.isFinite(current) ? current : 0;
  }

  if (upstashConfigured()) {
    try {
      const raw = await upstashCommand(["INCRBY", key, delta]);
      if (raw != null) {
        const value = Number(raw);
        if (Number.isFinite(value)) {
          if (value === delta) {
            await upstashCommand(["EXPIRE", key, ttlSeconds]);
          }
          return value;
        }
      }
    } catch {
      /* fall through to memory */
    }
  }

  pruneMemory();
  const entry = memory.get(key);
  const now = Date.now();
  const prev =
    entry && entry.expiresAt > now && Number.isFinite(Number(entry.value))
      ? Number(entry.value)
      : 0;
  const next = prev + delta;
  memory.set(key, {
    value: String(next),
    expiresAt: now + Math.max(1, ttlSeconds) * 1000,
  });
  return next;
}
