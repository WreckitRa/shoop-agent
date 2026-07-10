/** Hydration funnel config — bench buffer for verified pool sizing. */
export const HYDRATION_BENCH_MULTIPLIER = 3.5;

/** Cap parallel get_product calls in the initial hydration wave. */
export const HYDRATION_MAX_INITIAL_WAVE = 20;

/**
 * Max get_product calls truly in flight at once within a wave. A wave may
 * schedule up to HYDRATION_MAX_INITIAL_WAVE candidates, but firing all of them
 * simultaneously stampedes the catalog API — under ~11-wide concurrency the
 * per-call 3s budget was blowing (fail rate 0.73–1.0). Cap in-flight calls so
 * each gets its full timeout budget without contention.
 */
export const HYDRATION_MAX_CONCURRENCY = 6;

/** Per-call get_product timeout (ms). */
export const HYDRATION_CALL_TIMEOUT_MS = 5000;

/**
 * One retry for a call that hits the timeout (not abort). Timeouts under a
 * concurrency stampede are usually transient — the herd clears and the retry
 * succeeds — so a single re-attempt recovers most hydration_failed candidates.
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
