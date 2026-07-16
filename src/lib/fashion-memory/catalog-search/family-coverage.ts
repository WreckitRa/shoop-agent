/**
 * Rolling coverage telemetry per garment family — searches run vs slots that
 * ended thin/empty after hard drops. Surfaced on /health for catalog gaps
 * (e.g. watches on an apparel-heavy whitelist).
 */

const MAX_SAMPLES = 400;
const COVERAGE_GAP_MIN_SURVIVORS = 3;

export type FamilyCoverageSample = {
  garment_family: string;
  searches: number;
  thin_or_empty: number;
  survivors: number;
  ts: number;
};

const byFamily = new Map<
  string,
  { searches: number; thin_or_empty: number; last_survivors: number }
>();
const recent: FamilyCoverageSample[] = [];

function normalizeFamily(garment: string): string {
  return garment.trim().toLowerCase().replace(/\s+/g, " ") || "unknown";
}

/** Record one slot outcome after drops / before curation. */
export function recordFamilyCoverage(params: {
  garment: string;
  survivorsAfterDrops: number;
}): void {
  const family = normalizeFamily(params.garment);
  const thin = params.survivorsAfterDrops < COVERAGE_GAP_MIN_SURVIVORS;
  const cur = byFamily.get(family) ?? {
    searches: 0,
    thin_or_empty: 0,
    last_survivors: 0,
  };
  cur.searches += 1;
  if (thin) cur.thin_or_empty += 1;
  cur.last_survivors = params.survivorsAfterDrops;
  byFamily.set(family, cur);

  recent.push({
    garment_family: family,
    searches: cur.searches,
    thin_or_empty: cur.thin_or_empty,
    survivors: params.survivorsAfterDrops,
    ts: Date.now(),
  });
  if (recent.length > MAX_SAMPLES) recent.shift();
}

export function isCoverageGapPool(survivorCount: number): boolean {
  return survivorCount < COVERAGE_GAP_MIN_SURVIVORS;
}

export function familyCoverageSnapshot(): {
  families: Array<{
    garment_family: string;
    searches: number;
    thin_or_empty: number;
    thin_rate: number;
    last_survivors: number;
  }>;
  recent: FamilyCoverageSample[];
} {
  const families = [...byFamily.entries()]
    .map(([garment_family, v]) => ({
      garment_family,
      searches: v.searches,
      thin_or_empty: v.thin_or_empty,
      thin_rate: v.searches ? v.thin_or_empty / v.searches : 0,
      last_survivors: v.last_survivors,
    }))
    .sort((a, b) => b.thin_rate - a.thin_rate || b.searches - a.searches);

  return { families, recent: recent.slice(-40) };
}

/** Test helper. */
export function resetFamilyCoverageForTests(): void {
  byFamily.clear();
  recent.length = 0;
}

export { COVERAGE_GAP_MIN_SURVIVORS };
