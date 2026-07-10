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
  const data = (await res.json()) as { result?: string | null };
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
