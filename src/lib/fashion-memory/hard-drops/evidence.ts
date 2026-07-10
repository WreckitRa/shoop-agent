/**
 * Field availability notes (verified against Stage 2 storage — normalize-hit.ts, catalog.ts):
 *
 * - `metadata.attributes` (Global Catalog extension): MAY be present on `product.raw`
 *   as ML-inferred name/value pairs (Material, Fabric, Composition). Parsed via
 *   extractCatalogAttributes(). Variable accuracy — absence proves nothing.
 * - `categories` / taxonomy: NOT stored as a GID array. We lift a single
 *   `taxonomy_category` string from taxonomy_category | category | product_type |
 *   metadata fields. Often absent (~coverage.with_taxonomy).
 * - `availableForSale` (product-level): NOT observed on search-level
 *   CatalogProductSummary in this codebase. Checked best-effort; absent → no action.
 * - Variant `availability.available`: MAY be present on `raw.variants[]` at search
 *   level. Search already sends filters.available:true, so dead inventory rarely
 *   arrives; variant checks are a cheap double-net. Absent → no action.
 * - `description`: Usually absent at search level (get_product shape). Read
 *   best-effort from extended raw fields when present.
 */
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";

export type MaterialEvidenceSource = "attribute" | "title" | "description";

const MATERIAL_ATTR_RE =
  /\b(material|fabric|composition|fibre|fiber|matière|matiere|stoff|tela)\b/i;

export function readProductAvailableForSale(
  raw: CatalogProductSummary,
): boolean | undefined {
  const extended = raw as CatalogProductSummary & {
    available_for_sale?: boolean;
    availableForSale?: boolean;
  };
  if (typeof extended.available_for_sale === "boolean") {
    return extended.available_for_sale;
  }
  if (typeof extended.availableForSale === "boolean") {
    return extended.availableForSale;
  }
  return undefined;
}

export function allVariantsExplicitlyUnavailable(
  raw: CatalogProductSummary,
): boolean {
  const variants = raw.variants ?? [];
  if (!variants.length) return false;
  const withSignal = variants.filter((v) => v.availability?.available != null);
  if (!withSignal.length) return false;
  return withSignal.every((v) => v.availability?.available === false);
}

export function readProductDescription(raw: CatalogProductSummary): string | undefined {
  const extended = raw as CatalogProductSummary & {
    description?: { text?: string; html?: string } | string;
  };
  if (typeof extended.description === "string") {
    const text = extended.description.trim();
    return text || undefined;
  }
  const text = extended.description?.text?.trim();
  if (text) return text;
  const html = extended.description?.html?.trim();
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || undefined;
}

export function materialAttributeTexts(product: FashionSlotCatalogProduct): string[] {
  const attrs = extractCatalogAttributes(product.raw);
  return attrs
    .filter((a) => MATERIAL_ATTR_RE.test(a.name))
    .map((a) => a.value)
    .filter(Boolean);
}

export function evidenceTextsBySource(
  product: FashionSlotCatalogProduct,
): Record<MaterialEvidenceSource, string[]> {
  const description = readProductDescription(product.raw);
  return {
    attribute: materialAttributeTexts(product),
    title: product.title?.trim() ? [product.title.trim()] : [],
    description: description ? [description] : [],
  };
}
