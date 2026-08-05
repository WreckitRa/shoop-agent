import type { CatalogProductSummary } from "@/lib/shopify/catalog";

/** Stable cross-merchant product key when present, else catalog id. */
export function productUpid(product: CatalogProductSummary): string {
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
