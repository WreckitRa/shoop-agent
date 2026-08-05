/**
 * Cached category-name -> Shopify taxonomy GID map + category discovery.
 *
 * The `categories` filter requires a taxonomy GID we don't know up front. We
 * discover it by reading the dominant `categories` field off wave-1 results,
 * then optionally re-query with the discovered GID. A wrong GID silently
 * returns zero good results, so when unsure we OMIT `categories`.
 *
 * Per-process in-memory cache only (no catalog-result caching — that's
 * prohibited; this caches the name->GID mapping, not products).
 */
import type { CatalogProductSummary } from "@/lib/shopify/catalog";

const nameToGid = new Map<string, string>();

function key(name: string): string {
  return name.trim().toLowerCase();
}

export function getCachedCategoryGid(name: string): string | undefined {
  if (!name) return undefined;
  return nameToGid.get(key(name));
}

export function cacheCategoryGid(name: string, gid: string): void {
  if (!name || !gid) return;
  nameToGid.set(key(name), gid);
}

type RawCategory = { id?: string; gid?: string; name?: string; title?: string };

export function readProductCategories(product: CatalogProductSummary): RawCategory[] {
  const raw = (product as unknown as { categories?: unknown }).categories;
  if (!Array.isArray(raw)) return [];
  const out: RawCategory[] = [];
  for (const c of raw) {
    if (c && typeof c === "object") out.push(c as RawCategory);
    else if (typeof c === "string") out.push({ id: c });
  }
  return out;
}

export type DiscoveredCategory = { id: string; name?: string; count: number };

/**
 * Read the dominant taxonomy category GID off a set of search results. Returns
 * the most frequent category so the engine can fire one tightened re-query.
 * Caches discovered name->GID mappings as a side effect.
 */
export function discoverDominantCategory(
  products: CatalogProductSummary[],
): DiscoveredCategory | undefined {
  const counts = new Map<string, DiscoveredCategory>();
  for (const p of products) {
    for (const c of readProductCategories(p)) {
      const id = c.id ?? c.gid;
      if (!id) continue;
      const name = c.name ?? c.title;
      const existing = counts.get(id);
      if (existing) existing.count += 1;
      else counts.set(id, { id, name, count: 1 });
      if (name) cacheCategoryGid(name, id);
    }
  }
  let best: DiscoveredCategory | undefined;
  for (const v of counts.values()) {
    if (!best || v.count > best.count) best = v;
  }
  // Require a clear majority signal before trusting the GID.
  if (best && products.length && best.count / products.length >= 0.4) {
    return best;
  }
  return undefined;
}
