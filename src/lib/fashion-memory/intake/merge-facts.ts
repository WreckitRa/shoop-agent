import type { FashionFactRow } from "../types";

/** Merge key — size facts must not collapse across garment buckets. */
export function fashionFactMergeKey(fact: FashionFactRow): string {
  const gt = (fact.garment_type ?? "").trim().toLowerCase();
  return gt ? `${fact.fact_type}:${gt}` : fact.fact_type;
}

/** Latest incoming wins per merge key. */
export function mergeFashionFacts(
  existing: FashionFactRow[],
  incoming: FashionFactRow[],
): FashionFactRow[] {
  const map = new Map(existing.map((f) => [fashionFactMergeKey(f), f]));
  for (const f of incoming) {
    map.set(fashionFactMergeKey(f), f);
  }
  return [...map.values()];
}
