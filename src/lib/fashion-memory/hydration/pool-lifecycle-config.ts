function readVerifyTtlHours(): number {
  const raw = process.env.VERIFY_TTL_HOURS;
  if (raw == null || raw === "") return 24;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 24;
  return n;
}

/** Hydration verification expires after this many hours — re-verify on promote paths. */
export const VERIFY_TTL_HOURS = readVerifyTtlHours();

/** Pool candidate payloads persist for the search working lifecycle, then cleanup strips heavy fields. */
export const POOL_WORKING_LIFECYCLE_DAYS = 14;

export function verifyTtlMs(): number {
  return VERIFY_TTL_HOURS * 60 * 60 * 1000;
}

export function poolLifecycleMs(): number {
  return POOL_WORKING_LIFECYCLE_DAYS * 24 * 60 * 60 * 1000;
}
