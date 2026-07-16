/** Hydration funnel config — bench buffer for verified pool sizing. */
export const HYDRATION_BENCH_MULTIPLIER = 3.5;

/** Cap parallel get_product calls in the initial hydration wave. */
export const HYDRATION_MAX_INITIAL_WAVE = 20;

/**
 * Max get_product calls in flight for an entire hydration request (all slots).
 * Support slots fill in parallel — a per-slot cap of 6 becomes ~18 and stampedes
 * the catalog. Override with HYDRATION_MAX_CONCURRENCY.
 */
function readHydrationMaxConcurrency(): number {
  const raw = process.env.HYDRATION_MAX_CONCURRENCY;
  if (raw == null || raw.trim() === "") return 6;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 6;
  return Math.min(32, Math.round(n));
}

export const HYDRATION_MAX_CONCURRENCY = readHydrationMaxConcurrency();

/**
 * Transient get_product retries (network / MCP blips). Used whether or not a
 * per-call timeout is set.
 */
export const HYDRATION_TRANSIENT_RETRIES = 2;

function readHydrationCallTimeoutMs(): number | null {
  const raw = process.env.HYDRATION_CALL_TIMEOUT_MS;
  // Default: no per-call timeout — log elapsed_ms and tune from production.
  if (raw == null || raw.trim() === "" || raw === "0" || raw === "off") {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Per-call get_product timeout in ms, or `null` when disabled.
 * Set `HYDRATION_CALL_TIMEOUT_MS` in env to experiment (e.g. 8000, 12000).
 */
export const HYDRATION_CALL_TIMEOUT_MS = readHydrationCallTimeoutMs();

/**
 * Extra retries when a per-call timeout is enabled (stacked with transient retries).
 */
export const HYDRATION_TIMEOUT_RETRIES = 1;

/** Default transparent overflow tail size. */
export const HYDRATION_DEFAULT_OVERFLOW = 10;

export function hydrationTargetCount(optionsWanted: number): number {
  return Math.max(1, Math.ceil(optionsWanted * HYDRATION_BENCH_MULTIPLIER));
}

export function hydrationInitialWaveSize(target: number): number {
  return Math.min(target, HYDRATION_MAX_INITIAL_WAVE);
}
