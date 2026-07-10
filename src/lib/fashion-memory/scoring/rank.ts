import type { FashionCatalogQueryLog } from "../catalog-search/types";

/** Best (lowest) 0-indexed rank per product across variant result lists. */
export function buildBestRankByProductId(
  queryLogs: FashionCatalogQueryLog[],
): Map<string, number> {
  const best = new Map<string, number>();
  for (const log of queryLogs) {
    if (log.status !== "ok") continue;
    const products = log.products ?? [];
    for (let rank = 0; rank < products.length; rank++) {
      const id = products[rank]?.id?.trim();
      if (!id) continue;
      const prev = best.get(id);
      if (prev === undefined || rank < prev) best.set(id, rank);
    }
  }
  return best;
}

export function bestRankForProduct(
  productId: string,
  rankMap: Map<string, number>,
  fallback = 80,
): number {
  return rankMap.get(productId) ?? fallback;
}
