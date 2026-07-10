/**
 * Priced-lane junk-share telemetry — proves relevance-guard effectiveness.
 * Junk = category_mismatch + department_mismatch (+ item_type) / priced-lane results.
 */

const MAX_SAMPLES = 200;

export type PricedLaneJunkSample = {
  slot_id: string;
  junk_ratio: number;
  priced_lane_count: number;
  junk_drops: number;
  guard_band_count: number;
  enforced_max?: number;
  guard_max?: number;
  ts: number;
};

const samples: PricedLaneJunkSample[] = [];

export function recordPricedLaneJunkShare(sample: PricedLaneJunkSample): void {
  samples.push(sample);
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

export function pricedLaneJunkSnapshot(): {
  count: number;
  junk_ratio_p50: number | null;
  junk_ratio_p90: number | null;
  guard_band_count_p50: number | null;
  recent: PricedLaneJunkSample[];
} {
  const ratios = samples.map((s) => s.junk_ratio).sort((a, b) => a - b);
  const bands = samples.map((s) => s.guard_band_count).sort((a, b) => a - b);
  return {
    count: samples.length,
    junk_ratio_p50: percentile(ratios, 0.5),
    junk_ratio_p90: percentile(ratios, 0.9),
    guard_band_count_p50: percentile(bands, 0.5),
    recent: samples.slice(-20),
  };
}

/** Test helper. */
export function resetPricedLaneJunkForTests(): void {
  samples.length = 0;
}
