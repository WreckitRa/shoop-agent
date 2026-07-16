import type { RefEntry } from "../curation/types";
import type { CurationRefRegistry } from "../curation/types";

/** Deterministic coherence score against a look anchor (0–1). */
export function coherenceScoreAgainstAnchor(
  candidate: RefEntry,
  anchor: RefEntry,
): number {
  let score = 0.5;
  const cColors = candidate.candidate.normalized?.colors?.buckets ?? [];
  const aColors = anchor.candidate.normalized?.colors?.buckets ?? [];
  if (cColors.length && aColors.length) {
    const overlap = cColors.filter((c) =>
      aColors.some((a) => a.toLowerCase() === c.toLowerCase()),
    ).length;
    score += overlap > 0 ? 0.25 : -0.1;
  }

  const priceC =
    (candidate.candidate.final_price ?? candidate.candidate.price)?.amount ?? 0;
  const priceA =
    (anchor.candidate.final_price ?? anchor.candidate.price)?.amount ?? 0;
  if (priceC > 0 && priceA > 0) {
    const ratio = priceC / priceA;
    if (ratio >= 0.5 && ratio <= 2) score += 0.05;
  }

  return Math.max(0, Math.min(1, score));
}

export function rankBenchForLook(params: {
  registry: CurationRefRegistry;
  slotId: string;
  anchorRef: string;
  excludeRefs?: Set<string>;
}): RefEntry[] {
  const anchor = params.registry.get(params.anchorRef);
  if (!anchor) return [];

  const bench = [...params.registry.values()].filter(
    (e) =>
      e.slot_id === params.slotId &&
      e.ref !== params.anchorRef &&
      !params.excludeRefs?.has(e.ref),
  );

  return bench.sort((a, b) => {
    const scoreA = coherenceScoreAgainstAnchor(a, anchor);
    const scoreB = coherenceScoreAgainstAnchor(b, anchor);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.score_rank - b.score_rank;
  });
}
