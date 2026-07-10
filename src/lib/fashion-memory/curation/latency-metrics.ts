/** In-process curation latency samples for /health tripwires. */

const MAX_SAMPLES = 200;
const samples: number[] = [];

export function recordCurationLatencyMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

export function curationLatencySnapshot(params?: {
  tripwireMs?: number;
}): {
  count: number;
  p50_ms: number | null;
  p90_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  tripwire_ms: number;
  tripwire_triggered: boolean;
} {
  const tripwireMs = params?.tripwireMs ?? 90_000;
  const sorted = [...samples].sort((a, b) => a - b);
  const p90 = percentile(sorted, 0.9);
  return {
    count: sorted.length,
    p50_ms: percentile(sorted, 0.5),
    p90_ms: p90,
    p99_ms: percentile(sorted, 0.99),
    max_ms: sorted.length ? sorted[sorted.length - 1]! : null,
    tripwire_ms: tripwireMs,
    tripwire_triggered: p90 != null && p90 > tripwireMs,
  };
}

/** Test helper. */
export function resetCurationLatencyForTests(): void {
  samples.length = 0;
}
