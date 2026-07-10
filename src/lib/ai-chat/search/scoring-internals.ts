import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";

/** Shared candidate text helper for similar scoring (avoids circular imports). */
export function candidateText(product: CatalogProductSummary): string {
  const parts: string[] = [product.title ?? ""];
  for (const a of extractCatalogAttributes(product)) {
    parts.push(a.name, a.value);
  }
  for (const opt of product.options ?? []) {
    parts.push(opt.name);
    for (const v of opt.values ?? []) parts.push(v.label);
  }
  return parts.join(" ").toLowerCase();
}
