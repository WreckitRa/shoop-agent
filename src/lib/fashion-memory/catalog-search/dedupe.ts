import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { colorWordsInQuery } from "../search-planner/validator";
import type { CatalogLane } from "./category-hedge";
import { normalizeCatalogHit } from "./normalize-hit";
import type { FashionSlotCatalogProduct } from "./types";
import { catalogDedupeKey } from "./product-id";

export type VariantQueryHit = {
  variantIndex: number;
  products: CatalogProductSummary[];
  carriesColor?: boolean;
  category_filtered: boolean;
  lane?: CatalogLane;
};

/**
 * Dedupe catalog hits within a slot by product id/UPID.
 * Merges matched_by variant indices — multi-variant hits are corroboration.
 */
export function dedupeSlotCatalogHits(
  hits: VariantQueryHit[],
): FashionSlotCatalogProduct[] {
  const byKey = new Map<string, FashionSlotCatalogProduct>();
  const colorVariantIndices = new Set(
    hits.filter((h) => h.carriesColor).map((h) => h.variantIndex),
  );
  const unfilteredVariantIndices = new Set(
    hits.filter((h) => !h.category_filtered).map((h) => h.variantIndex),
  );
  const laneByVariant = new Map<number, CatalogLane>();
  for (const h of hits) {
    if (h.lane) laneByVariant.set(h.variantIndex, h.lane);
  }

  for (const { variantIndex, products, lane } of hits) {
    for (const raw of products) {
      const key = catalogDedupeKey(raw);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.matched_by.includes(variantIndex)) {
          existing.matched_by.push(variantIndex);
        }
        if (colorVariantIndices.has(variantIndex)) {
          existing.matched_by_color_variant = true;
        }
        if (lane) {
          const lanes = existing.matched_by_lanes ?? [];
          if (!lanes.includes(lane)) {
            existing.matched_by_lanes = [...lanes, lane];
          }
        }
        continue;
      }
      byKey.set(
        key,
        normalizeCatalogHit({
          raw,
          upid: catalogDedupeKey(raw),
          matched_by: [variantIndex],
          matched_by_color_variant: colorVariantIndices.has(variantIndex),
          matched_by_lanes: lane ? [lane] : undefined,
        }),
      );
    }
  }

  for (const entry of byKey.values()) {
    entry.matched_by.sort((a, b) => a - b);
    entry.matched_only_unfiltered =
      entry.matched_by.length > 0 &&
      entry.matched_by.every((idx) => unfilteredVariantIndices.has(idx));
    if (!entry.matched_by_lanes?.length) {
      const inferred = entry.matched_by
        .map((idx) => laneByVariant.get(idx))
        .filter((l): l is CatalogLane => Boolean(l));
      if (inferred.length) {
        entry.matched_by_lanes = [...new Set(inferred)];
      }
    } else {
      entry.matched_by_lanes = [...new Set(entry.matched_by_lanes)].sort();
    }
  }

  return [...byKey.values()];
}

export function perVariantRawCounts(hits: VariantQueryHit[]): number[] {
  const maxIdx = hits.reduce((m, h) => Math.max(m, h.variantIndex), -1);
  const counts = Array.from({ length: maxIdx + 1 }, () => 0);
  for (const { variantIndex, products } of hits) {
    counts[variantIndex] = products.length;
  }
  return counts;
}

export function variantCarriesColor(query: string): boolean {
  return colorWordsInQuery(query).length > 0;
}
