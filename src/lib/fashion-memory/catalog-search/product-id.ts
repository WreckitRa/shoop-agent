import type { CatalogProductSummary } from "@/lib/shopify/catalog";

/** Best-effort cross-merchant cluster id; falls back to product id. */
export function catalogProductUpid(product: CatalogProductSummary): string {
  const raw = product as unknown as Record<string, unknown>;
  for (const key of [
    "upid",
    "universal_product_id",
    "universalProductId",
    "product_id",
  ]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return product.id;
}

export function catalogDedupeKey(product: CatalogProductSummary): string {
  return catalogProductUpid(product) || product.id;
}
