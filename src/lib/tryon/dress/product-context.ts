import type { HydratedCandidate } from "@/lib/fashion-memory/hydration/types";
import type { CatalogProductDetail } from "@/lib/shopify/catalog";
import {
  extractCatalogAttributes,
  type CatalogInferredAttribute,
} from "@/lib/shopify/catalog-attributes";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { getProduct } from "@/lib/shopify/catalog";
import type { GarmentType } from "../types";
import { TRYON_DRESS_PROMPT_VERSION } from "./prompt";

export type TryonProductContext = {
  prompt_version: typeof TRYON_DRESS_PROMPT_VERSION;
  product_id: string;
  title: string;
  brand?: string;
  merchant?: string;
  garment_type: GarmentType;
  slot_garment: string;
  price?: string;
  selected_size?: string;
  selected_color?: string;
  /** Canonical color buckets from normalize layer. */
  normalized_colors?: string[];
  /** Fit modifier from size normalize (slim/relaxed/…) when known. */
  size_fit_modifier?: string;
  size_status?: string;
  size_converted_from?: string;
  description?: string;
  taxonomy_category?: string;
  variant_options?: string;
  material_notes: string[];
  style_notes: string[];
  fit_notes: string[];
  other_attributes: string[];
  suspicions: string[];
  seller?: string;
  rating?: string;
  availability?: string;
  option_matrix_summary?: string;
  stylist_line?: string;
  corrected_color?: string;
  badges: string[];
  garment_image_url?: string;
  occasion_context?: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function summarizeOptions(detail?: CatalogProductDetail): string | undefined {
  if (!detail?.options?.length) return undefined;
  return detail.options
    .map((opt) => {
      const values = opt.values
        .slice(0, 8)
        .map((v) => v.label)
        .join(", ");
      const more =
        opt.values.length > 8 ? ` (+${opt.values.length - 8} more)` : "";
      return `${opt.name}: ${values}${more}`;
    })
    .join(" | ");
}

function variantAvailability(detail?: CatalogProductDetail): string | undefined {
  const selected = detail?.selected ?? [];
  if (!selected.length || !detail?.variants?.length) return undefined;
  const match = detail.variants.find((v) => {
    const opts = v.options ?? [];
    return selected.every((s) =>
      opts.some(
        (o) =>
          o.name.toLowerCase() === s.name.toLowerCase() &&
          o.label.toLowerCase() === s.label.toLowerCase(),
      ),
    );
  });
  if (!match?.availability) return undefined;
  const parts = [
    match.availability.available === false ? "out of stock" : "in stock",
    match.availability.running_low ? "running low" : null,
    match.availability.status,
  ].filter(Boolean);
  return parts.join(", ") || undefined;
}

function partitionAttributes(attrs: Array<{ name: string; value: string }>) {
  const material: string[] = [];
  const style: string[] = [];
  const fit: string[] = [];
  const other: string[] = [];
  for (const a of attrs) {
    const key = a.name.toLowerCase();
    const line = `${a.name}: ${a.value}`;
    if (
      /material|fabric|fiber|composition|shell|lining|fill|knit|weave|weight|stretch|finish|hand feel/.test(
        key,
      )
    ) {
      material.push(line);
    } else if (
      /fit|silhouette|rise|inseam|length|cut|taper|relax|slim|oversiz|petite|tall|regular/.test(
        key,
      )
    ) {
      fit.push(line);
    } else if (
      /style|occasion|neckline|collar|sleeve|cuff|pattern|print|graphic|closure|button|zip|heel|toe|waistband|lapel|pocket/.test(
        key,
      )
    ) {
      style.push(line);
    } else {
      other.push(line);
    }
  }
  return { material, style, fit, other };
}

function collectAttributes(params: {
  candidate: HydratedCandidate;
  pickAttrs?: CatalogInferredAttribute[];
}): CatalogInferredAttribute[] {
  const attrs = [
    ...extractCatalogAttributes(params.candidate.detail),
    ...extractCatalogAttributes(params.candidate.raw),
    ...(params.pickAttrs ?? []),
  ];
  const seen = new Set<string>();
  return attrs.filter((a) => {
    const key = `${a.name}:${a.value}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type TryonProductPickInput = {
  stylist_line?: string;
  corrected_color?: string;
  badges?: Array<{ kind: string; [key: string]: unknown }>;
  catalogAttributes?: CatalogInferredAttribute[];
};

export function buildTryonProductContext(params: {
  candidate: HydratedCandidate;
  garmentType: GarmentType;
  garmentImageUrl?: string;
  pick?: TryonProductPickInput;
  occasionContext?: string;
}): TryonProductContext {
  const { candidate } = params;
  const detail = candidate.detail;
  const dedupedAttrs = collectAttributes({
    candidate,
    pickAttrs: params.pick?.catalogAttributes,
  });
  const partitioned = partitionAttributes(dedupedAttrs);

  const description =
    detail?.description?.text?.trim() ||
    (detail?.description?.html
      ? stripHtml(detail.description.html)
      : undefined) ||
    candidate.description_text?.trim();

  const price = candidate.final_price ?? candidate.price;
  const rating = detail?.rating
    ? detail.rating
    : candidate.rating_value != null
      ? {
          value: candidate.rating_value,
          scaleMax: candidate.rating_scale_max ?? 5,
          count: candidate.review_count ?? 0,
        }
      : undefined;

  const badges: string[] = [];
  for (const b of params.pick?.badges ?? []) {
    if (b.kind === "size_converted" && "merchant_label" in b) {
      badges.push(`Size converted to ${String(b.merchant_label)}`);
    } else if (b.kind === "material_suspected" && "evidence" in b) {
      badges.push(String(b.evidence));
    } else if (b.kind === "photo_color" && "color" in b) {
      badges.push(`Listing photo color: ${String(b.color)}`);
    } else if (b.kind && "label" in b && typeof b.label === "string") {
      badges.push(b.label);
    }
  }

  const suspicions = (candidate.suspicions ?? [])
    .map((s) => s.evidence?.trim() || s.rule)
    .filter(Boolean)
    .slice(0, 8);

  const normalizedColors =
    candidate.normalized?.colors?.status === "resolved"
      ? candidate.normalized.colors.buckets.filter((b) => b !== "unknown")
      : undefined;

  const sizeFitModifier = candidate.normalized?.sizes
    ?.map((s) => s.size?.fit_modifier)
    .find(Boolean);

  const fitNotes = [
    ...partitioned.fit,
    ...(sizeFitModifier ? [`Fit modifier: ${sizeFitModifier}`] : []),
    candidate.size_selection?.converted_from
      ? `Size converted from ${candidate.size_selection.converted_from}`
      : null,
  ].filter(Boolean) as string[];

  // Stylist_line is for UI — only fold into style notes when it sounds visual.
  if (params.pick?.stylist_line) {
    const line = params.pick.stylist_line.trim();
    if (
      line &&
      /\b(tuck|sleeve|open|button|collar|layer|drape|cuff|hem|fit|silhouette|roll)\b/i.test(
        line,
      )
    ) {
      partitioned.style.unshift(`Stylist cue: ${line}`);
    }
  }

  return {
    prompt_version: TRYON_DRESS_PROMPT_VERSION,
    product_id: candidate.id,
    title: detail?.title ?? candidate.title,
    brand: detail?.brand,
    merchant: detail?.seller?.name ?? candidate.shop_domain,
    garment_type: params.garmentType,
    slot_garment:
      (candidate as { garment?: string }).garment ?? params.garmentType,
    price: price ? formatMoney(price.amount, price.currency) : undefined,
    selected_size: candidate.size_selection?.merchant_label,
    selected_color:
      params.pick?.corrected_color ??
      candidate.color_selection?.merchant_label,
    normalized_colors: normalizedColors,
    size_fit_modifier: sizeFitModifier,
    size_status: candidate.size_status,
    size_converted_from: candidate.size_selection?.converted_from,
    description: description?.slice(0, 1200),
    taxonomy_category: candidate.taxonomy_category,
    variant_options:
      candidate.variant_options
        ?.map((v) => `${v.name}: ${v.value}`)
        .join(" · ") || undefined,
    material_notes: partitioned.material.slice(0, 12),
    style_notes: partitioned.style.slice(0, 12),
    fit_notes: fitNotes.slice(0, 8),
    other_attributes: partitioned.other.slice(0, 16),
    suspicions,
    seller: detail?.seller?.name,
    rating: rating
      ? `${rating.value}/${rating.scaleMax} (${rating.count} reviews)`
      : undefined,
    availability: variantAvailability(detail),
    option_matrix_summary: summarizeOptions(detail),
    stylist_line: params.pick?.stylist_line,
    corrected_color: params.pick?.corrected_color,
    badges,
    garment_image_url: params.garmentImageUrl,
    occasion_context: params.occasionContext?.trim() || undefined,
  };
}

/** Refresh get_product when hydration detail is missing (buyer size/color aware). */
export async function resolveTryonProductDetail(
  candidate: HydratedCandidate,
): Promise<CatalogProductDetail | undefined> {
  if (candidate.detail) return candidate.detail;
  const selected: Array<{ name: string; label: string }> = [];
  if (candidate.size_selection) {
    selected.push({
      name: candidate.size_selection.option_name,
      label: candidate.size_selection.merchant_label,
    });
  }
  if (candidate.color_selection) {
    selected.push({
      name: candidate.color_selection.option_name,
      label: candidate.color_selection.merchant_label,
    });
  }
  try {
    const token = await accessTokenForCatalogMcp();
    const { product } = await getProduct(token, candidate.id, selected);
    return product;
  } catch {
    return undefined;
  }
}

export function tryonProductContextFromCandidate(params: {
  candidate: HydratedCandidate;
  garmentType: GarmentType;
  garmentImageUrl?: string;
  pick?: TryonProductPickInput;
  detail?: CatalogProductDetail;
  occasionContext?: string;
}): TryonProductContext {
  const merged: HydratedCandidate = params.detail
    ? { ...params.candidate, detail: params.detail }
    : params.candidate;
  return buildTryonProductContext({
    candidate: merged,
    garmentType: params.garmentType,
    garmentImageUrl: params.garmentImageUrl,
    pick: params.pick,
    occasionContext: params.occasionContext,
  });
}
