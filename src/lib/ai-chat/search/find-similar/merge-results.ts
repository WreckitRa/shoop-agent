import type { CuratedPick, ProductCard } from "../../types";
import type { EngineSearchResult } from "../engine";
import { mergeTasteHypotheses } from "./hypothesis-store";
import type { TasteHypothesis } from "./types";

export type SimilarEngineResult = EngineSearchResult & {
  hypothesis: TasteHypothesis | null;
};

function dedupeKey(product: { id: string; upid?: string }): string {
  return product.upid?.trim() || product.id;
}

function isExcluded(
  product: { id: string; upid?: string },
  excludeProductIds: Set<string>,
  excludeUpids: Set<string>,
): boolean {
  if (excludeProductIds.has(product.id)) return true;
  if (product.upid?.trim() && excludeUpids.has(product.upid.trim())) return true;
  return false;
}

/** Merge parallel find-similar engine runs — overlap across seeds wins. */
export function mergeSimilarSearchResults(
  results: SimilarEngineResult[],
  excludeProductIds: Set<string>,
  excludeUpids: Set<string>,
  displayLimit: number,
): SimilarEngineResult {
  if (!results.length) {
    throw new Error("mergeSimilarSearchResults requires at least one result");
  }
  if (results.length === 1) return results[0]!;

  let hypothesis: TasteHypothesis | null = null;
  for (const result of results) {
    if (!result.hypothesis) continue;
    hypothesis = hypothesis
      ? mergeTasteHypotheses(hypothesis, result.hypothesis)
      : result.hypothesis;
  }

  type Ranked<T> = { item: T; overlap: number; rank: number };
  const productRank = new Map<string, Ranked<ProductCard>>();
  const pickRank = new Map<string, Ranked<CuratedPick>>();

  for (const result of results) {
    result.products.forEach((product, idx) => {
      if (isExcluded(product, excludeProductIds, excludeUpids)) return;
      const key = dedupeKey(product);
      const cur = productRank.get(key);
      if (cur) {
        cur.overlap += 1;
        cur.rank = Math.min(cur.rank, idx);
      } else {
        productRank.set(key, { item: product, overlap: 1, rank: idx });
      }
    });
    result.curatedPicks.forEach((pick, idx) => {
      if (isExcluded(pick, excludeProductIds, excludeUpids)) return;
      const key = dedupeKey(pick);
      const cur = pickRank.get(key);
      if (cur) {
        cur.overlap += 1;
        cur.rank = Math.min(cur.rank, idx);
      } else {
        pickRank.set(key, { item: pick, overlap: 1, rank: idx });
      }
    });
  }

  const byOverlap = <T>(entries: Ranked<T>[]) =>
    [...entries].sort(
      (a, b) => b.overlap - a.overlap || a.rank - b.rank,
    );

  const mergedPicks = byOverlap([...pickRank.values()]).map((x) => x.item);
  const mergedProducts = byOverlap([...productRank.values()]).map((x) => x.item);

  const seen = new Set<string>();
  const curatedPicks: CuratedPick[] = [];
  for (const pick of mergedPicks) {
    const key = dedupeKey(pick);
    if (seen.has(key)) continue;
    seen.add(key);
    curatedPicks.push(pick);
    if (curatedPicks.length >= 3) break;
  }

  const products: ProductCard[] = [];
  for (const product of mergedProducts) {
    const key = dedupeKey(product);
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(product);
    if (products.length >= displayLimit) break;
  }

  const base = results[0]!;
  return {
    ...base,
    products,
    curatedPicks,
    rawCount: results.reduce((sum, r) => sum + r.rawCount, 0),
    surfacedUpids: [...new Set(results.flatMap((r) => r.surfacedUpids))],
    stats: results.flatMap((r) => r.stats),
    thin: results.every((r) => r.thin),
    loosened: results.some((r) => r.loosened),
    slottingMethod: results.some((r) => r.slottingMethod === "tier_judge")
      ? "tier_judge"
      : "score_heuristic",
    curationFallback: results.some((r) => r.curationFallback),
    hypothesis,
  };
}
