import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type {
  CatalogProductDetail,
  CatalogProductSummary,
} from "@/lib/shopify/catalog";
import type { CuratedPick } from "../../types";
import type { SearchBrief } from "../types";
import { candidatePriceCents } from "../pool";

function descriptionText(
  detail?: CatalogProductDetail,
  summary?: CatalogProductSummary,
): string | undefined {
  const fromDetail = detail?.description?.text?.trim();
  if (fromDetail) return fromDetail.slice(0, 1200);
  const raw = summary as Record<string, unknown> | undefined;
  const d = raw?.description;
  return typeof d === "string" ? d.slice(0, 1200) : undefined;
}

function variantSnapshot(detail?: CatalogProductDetail) {
  const variants = detail?.variants?.slice(0, 8) ?? [];
  return variants.map((v) => ({
    id: v.id,
    title: v.title,
    price: v.price,
    options: v.options?.map((o) => ({ name: o.name, label: o.label })),
    available: v.availability?.available,
  }));
}

/** Compact Shopify payload for the similar-search planner LLM. */
export function formatSeedForPlanner(params: {
  pick: CuratedPick;
  brief: SearchBrief;
  detail?: CatalogProductDetail;
  summary?: CatalogProductSummary;
  confirmedAttribute?: string;
}): Record<string, unknown> {
  const { pick, brief, detail, summary, confirmedAttribute } = params;
  const priceCents =
    pick.displayPrice?.amount ??
    pick.priceRange?.min?.amount ??
    (detail ? candidatePriceCents(detail) : null) ??
    (summary ? candidatePriceCents(summary) : null);

  const catalogRaw = detail ?? summary;
  const metadata =
    catalogRaw && typeof catalogRaw === "object"
      ? (catalogRaw as CatalogProductSummary).metadata
      : undefined;

  return {
    product: {
      id: pick.id,
      title: pick.title,
      brand: detail?.brand,
      url: detail?.url,
      price_cents: priceCents,
      currency:
        pick.displayPrice?.currency ??
        pick.priceRange?.min?.currency ??
        brief.budget.currency,
      description: descriptionText(detail, summary),
      options:
        detail?.options ??
        pick.options ??
        summary?.options?.map((o) => ({
          name: o.name,
          values: o.values.map((v) => ({ label: v.label })),
        })),
      variants: variantSnapshot(detail),
      rating: detail?.rating ?? pick.rating,
      shopify_metadata: metadata,
      inferred_attributes: [
        ...(pick.catalogAttributes ?? []),
        ...extractCatalogAttributes(catalogRaw),
      ].map((a) => `${a.name}: ${a.value}`),
    },
    shopping_context: {
      original_query: brief.query,
      category: brief.category,
      budget: brief.budget,
      recipient: brief.recipient,
      use_case: brief.useCase,
      direction: brief.directionLabel,
    },
    user_confirmed_attribute: confirmedAttribute?.trim() || undefined,
  };
}
