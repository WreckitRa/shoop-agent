import {
  extractCatalogAttributes,
  formatCatalogAttributesForPrompt,
} from "@/lib/shopify/catalog-attributes";
import {
  parseCatalogRating,
  type CatalogProductDetail,
} from "@/lib/shopify/catalog";

const MAX_DESCRIPTION_CHARS = 600;
const MAX_SIZE_CHART_CHARS = 400;
const MAX_VARIANT_LINES = 12;
const MAX_REVIEW_SNIPPETS = 3;
const MAX_REVIEW_SNIPPET_CHARS = 140;

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractProductDescription(detail: CatalogProductDetail): string | null {
  const desc = detail.description;
  if (!desc) return null;
  const raw = desc as { text?: string; plain?: string; html?: string };
  const plain = raw.text?.trim() || raw.plain?.trim();
  if (plain) return truncate(plain, MAX_DESCRIPTION_CHARS);
  if (desc.html?.trim()) return truncate(stripHtml(desc.html), MAX_DESCRIPTION_CHARS);
  return null;
}

function metadataBlock(
  detail: CatalogProductDetail,
  key: "tech_specs" | "top_features" | "unique_selling_points",
): string | null {
  const block = detail.metadata?.[key];
  if (typeof block === "string" && block.trim()) {
    return truncate(block.trim(), 320);
  }
  if (Array.isArray(block)) {
    const joined = block
      .map((entry) => (typeof entry === "string" ? entry : null))
      .filter(Boolean)
      .join("; ");
    if (joined.trim()) return truncate(joined, 320);
  }
  return null;
}

export function formatMaterialsLine(detail: CatalogProductDetail): string | null {
  const techSpecs = metadataBlock(detail, "tech_specs");
  if (techSpecs) return techSpecs;
  const attrs = extractCatalogAttributes(detail);
  const materialish = attrs.filter((a) =>
    /material|fabric|composition|fiber|shell|lining/i.test(a.name),
  );
  if (materialish.length) {
    return materialish.map((a) => `${a.name}: ${a.value}`).join("; ");
  }
  return null;
}

export function formatResolvedOptionsLine(
  detail: CatalogProductDetail,
): string | null {
  if (!detail.options?.length) return null;
  return detail.options
    .map((o) => {
      const vals = o.values
        .map((v) => {
          const flags: string[] = [];
          if ("exists" in v && v.exists === false) flags.push("missing");
          else if ("available" in v) {
            flags.push(v.available ? "avail" : "unavail");
          }
          return flags.length ? `${v.label} (${flags.join(", ")})` : v.label;
        })
        .join(", ");
      return `${o.name}: ${vals}`;
    })
    .join("; ");
}

function variantOptionLabel(variant: NonNullable<CatalogProductDetail["variants"]>[number]): string {
  const fromOptions = variant.options?.map((o) => o.label).filter(Boolean);
  if (fromOptions?.length) return fromOptions.join(" / ");
  return variant.title?.trim() || "variant";
}

export function formatVariantMatrixLine(detail: CatalogProductDetail): string | null {
  const variants = detail.variants ?? [];
  if (!variants.length) return null;
  const lines = variants.slice(0, MAX_VARIANT_LINES).map((v) => {
    const label = variantOptionLabel(v);
    const price =
      typeof v.price?.amount === "number"
        ? `${(v.price.amount / 100).toFixed(2)} ${v.price.currency}`
        : "price n/a";
    const avail =
      v.availability?.available === false
        ? "out"
        : v.availability?.running_low
          ? "low"
          : "in";
    return `${label} · ${price} · ${avail}`;
  });
  if (variants.length > MAX_VARIANT_LINES) {
    lines.push(`+${variants.length - MAX_VARIANT_LINES} more SKUs`);
  }
  return lines.join("; ");
}

function readRawField(detail: CatalogProductDetail, ...keys: string[]): unknown {
  const raw = detail as CatalogProductDetail & Record<string, unknown>;
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  }
  const metadata = raw.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    for (const key of keys) {
      if (metadata[key] !== undefined && metadata[key] !== null) return metadata[key];
    }
  }
  return undefined;
}

export function extractSizeChart(detail: CatalogProductDetail): string | null {
  const chart = readRawField(detail, "size_chart", "sizeChart", "size_guide", "sizeGuide");
  if (typeof chart === "string" && chart.trim()) {
    return truncate(chart.trim(), MAX_SIZE_CHART_CHARS);
  }
  if (chart && typeof chart === "object") {
    const o = chart as Record<string, unknown>;
    const text =
      (typeof o.text === "string" && o.text) ||
      (typeof o.plain === "string" && o.plain) ||
      (typeof o.html === "string" && stripHtml(o.html)) ||
      null;
    if (text?.trim()) return truncate(text.trim(), MAX_SIZE_CHART_CHARS);
  }
  return null;
}

type ReviewSnippet = { body: string; rating?: number };

function parseReviewSnippet(entry: unknown): ReviewSnippet | null {
  if (typeof entry === "string") {
    const body = entry.trim();
    return body ? { body: truncate(body, MAX_REVIEW_SNIPPET_CHARS) } : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const body =
    (typeof o.body === "string" && o.body) ||
    (typeof o.text === "string" && o.text) ||
    (typeof o.summary === "string" && o.summary) ||
    (typeof o.content === "string" && o.content) ||
    null;
  if (!body?.trim()) return null;
  const rating =
    typeof o.rating === "number"
      ? o.rating
      : typeof o.score === "number"
        ? o.score
        : undefined;
  return { body: truncate(body.trim(), MAX_REVIEW_SNIPPET_CHARS), rating };
}

export function formatReviewSnippets(detail: CatalogProductDetail): string | null {
  const rawReviews = readRawField(
    detail,
    "reviews",
    "review_snippets",
    "reviewSnippets",
  );
  if (!Array.isArray(rawReviews)) return null;
  const snippets = rawReviews
    .map(parseReviewSnippet)
    .filter((s): s is ReviewSnippet => Boolean(s))
    .slice(0, MAX_REVIEW_SNIPPETS);
  if (!snippets.length) return null;
  return snippets
    .map((s) =>
      s.rating != null ? `"${s.body}" (${s.rating}★)` : `"${s.body}"`,
    )
    .join(" | ");
}

export function formatShippingLine(detail: CatalogProductDetail): string | null {
  const parts: string[] = [];
  const variant = detail.variants?.[0];
  const requires = (variant as { requires?: { shipping?: boolean } } | undefined)
    ?.requires;
  if (requires?.shipping === true) parts.push("requires shipping");
  if (requires?.shipping === false) parts.push("digital / no shipping");

  const seller =
    detail.seller ??
    (variant as { seller?: CatalogProductDetail["seller"] } | undefined)?.seller;
  if (seller?.name?.trim()) parts.push(`seller: ${seller.name.trim()}`);
  if (seller?.domain?.trim()) parts.push(`store: ${seller.domain.trim()}`);

  const links = (seller as { links?: Array<{ type?: string; url?: string }> } | undefined)
    ?.links;
  const shippingPolicy = links?.find((l) => l.type === "shipping_policy")?.url;
  if (shippingPolicy) parts.push("shipping policy on file");

  return parts.length ? parts.join("; ") : null;
}

export function formatRichJudgmentCandidateBlock(params: {
  id: string;
  title: string;
  priceLabel: string;
  detail: CatalogProductDetail;
  availabilityLine?: string;
  ratingLine?: string;
  reviewSnippets?: string;
  listingHygieneLine?: string;
  imageRef: string;
}): string {
  const { detail } = params;
  const attrs = extractCatalogAttributes(detail);
  const attrLine = formatCatalogAttributesForPrompt(attrs);
  const description = extractProductDescription(detail);
  const materials = formatMaterialsLine(detail);
  const topFeatures = metadataBlock(detail, "top_features");
  const usp = metadataBlock(detail, "unique_selling_points");
  const optionsLine = formatResolvedOptionsLine(detail);
  const variantsLine = formatVariantMatrixLine(detail);
  const sizeChart = extractSizeChart(detail);
  const shipping = formatShippingLine(detail);
  const reviewSnippets = formatReviewSnippets(detail);
  const brand = detail.brand?.trim();

  return [
    `id=${params.id}`,
    `title: ${params.title}`,
    brand ? `brand: ${brand}` : null,
    `price: ${params.priceLabel}`,
    description ? `description: ${description}` : null,
    materials ? `materials: ${materials}` : null,
    topFeatures ? `top_features: ${topFeatures}` : null,
    usp ? `unique_selling_points: ${usp}` : null,
    attrLine ? `inferred_attributes: ${attrLine}` : null,
    optionsLine ? `options: ${optionsLine}` : null,
    variantsLine ? `variants: ${variantsLine}` : null,
    sizeChart ? `size_chart: ${sizeChart}` : null,
    shipping ? `shipping: ${shipping}` : null,
    params.ratingLine ? `rating: ${params.ratingLine}` : null,
    params.listingHygieneLine ? `listing_hygiene: ${params.listingHygieneLine}` : null,
    reviewSnippets ? `review_snippets: ${reviewSnippets}` : null,
    params.availabilityLine ? `verified_availability: ${params.availabilityLine}` : null,
    `image_ref: ${params.imageRef}`,
  ]
    .filter(Boolean)
    .join("\n   ");
}

export function ratingLineFromDetail(detail: CatalogProductDetail): string | undefined {
  const rating = parseCatalogRating(detail.rating);
  if (!rating) return undefined;
  return `${rating.value.toFixed(1)}/${rating.scaleMax} (${rating.count} reviews)`;
}
