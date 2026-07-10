import type { SearchBrief } from "../types";

/**
 * Find-similar must not inherit the parent search budget/size locks.
 * Budget is anchored on the seed product price when known; otherwise cleared.
 */
export function relaxBriefForFindSimilar(
  brief: SearchBrief,
  seedPriceCents: number | null,
): SearchBrief {
  const relaxed: SearchBrief = {
    ...brief,
    variantConstraints: {},
  };

  if (seedPriceCents != null && seedPriceCents > 0) {
    const ceiling = Math.round(seedPriceCents * 1.45);
    relaxed.budget = {
      currency: relaxed.budget.currency,
      type: "soft",
      minCents: null,
      maxCents: ceiling,
      amountCents: ceiling,
    };
    return relaxed;
  }

  // No seed price — drop inherited filters so similar items are not pre-rejected.
  relaxed.budget = {
    ...relaxed.budget,
    type: "none",
    minCents: null,
    maxCents: null,
    amountCents: null,
  };

  return relaxed;
}

/** Exclude seed products only — not every pick curated earlier in the thread. */
export function buildFindSimilarExcludedKeys(
  seeds: Array<{ productId: string; upid?: string }>,
): Set<string> {
  const keys = new Set<string>();
  for (const seed of seeds) {
    keys.add(seed.productId);
    const upid = seed.upid?.trim();
    if (upid) keys.add(upid);
  }
  return keys;
}
