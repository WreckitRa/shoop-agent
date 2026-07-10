import {
  extractCatalogAttributes,
  formatCatalogAttributesForPrompt,
  type CatalogInferredAttribute,
} from "@/lib/shopify/catalog-attributes";
import type { CatalogProductDetail, CatalogProductSummary } from "@/lib/shopify/catalog";
import type { ShopifySearchProductCard } from "../shopify-search-tool";
import type { VerifiedCandidate } from "../search/verify";
import { formatListingHygieneLine } from "../search/listing-hygiene";
import {
  formatRichJudgmentCandidateBlock,
  ratingLineFromDetail,
} from "./rich-candidate-prompt";

export type JudgmentCandidate = {
  id: string;
  title: string;
  priceLabel: string;
  attributes: CatalogInferredAttribute[];
  optionsLine?: string;
  availabilityLine?: string;
  ratingLine?: string;
  imageRef: string;
};

function priceLabelFromCents(
  cents: number | null | undefined,
  currency = "USD",
): string {
  if (cents == null) return "price n/a";
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function optionsLine(
  options?: Array<{ name: string; values: Array<{ label: string }> }>,
): string | undefined {
  if (!options?.length) return undefined;
  return options
    .map(
      (o) =>
        `${o.name}: ${o.values
          .slice(0, 6)
          .map((v) => v.label)
          .join(", ")}`,
    )
    .join("; ");
}

export function judgmentCandidateFromSummary(
  product: CatalogProductSummary,
  index: number,
): JudgmentCandidate {
  const attrs = extractCatalogAttributes(product);
  const price = product.price_range?.min;
  return {
    id: product.id,
    title: product.title ?? "",
    priceLabel: price
      ? `${(price.amount / 100).toFixed(2)} ${price.currency}`
      : "price n/a",
    attributes: attrs,
    optionsLine: optionsLine(product.options),
    imageRef: `search-result-${index + 1}`,
  };
}

export function judgmentCandidateFromDetail(
  detail: CatalogProductDetail,
  resolvedPriceCents: number | null,
  extras?: {
    availabilityLine?: string;
    ratingLine?: string;
    index: number;
  },
): JudgmentCandidate {
  const attrs = extractCatalogAttributes(detail);
  const currency =
    detail.variants?.[0]?.price?.currency ?? "USD";
  return {
    id: detail.id,
    title: detail.title ?? "",
    priceLabel: priceLabelFromCents(resolvedPriceCents, currency),
    attributes: attrs,
    optionsLine: optionsLine(detail.options),
    availabilityLine: extras?.availabilityLine,
    ratingLine: extras?.ratingLine,
    imageRef: `candidate-${extras?.index ?? 0}`,
  };
}

export function formatJudgmentCandidateBlock(c: JudgmentCandidate): string {
  const attrLine = formatCatalogAttributesForPrompt(c.attributes);
  return [
    `id=${c.id}`,
    `title: ${c.title}`,
    `price: ${c.priceLabel}`,
    attrLine ? `attributes: ${attrLine}` : `attributes: (none inferred)`,
    c.optionsLine ? `options: ${c.optionsLine}` : null,
    c.availabilityLine ? `availability: ${c.availabilityLine}` : null,
    c.ratingLine ? `rating: ${c.ratingLine}` : null,
    `image_ref: ${c.imageRef}`,
  ]
    .filter(Boolean)
    .join("\n   ");
}

/** Present candidates in non-rank order so the model cannot sort by arrival position. */
export function shuffleForJudgment<T extends { upid: string }>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    let h = 0;
    for (const ch of out[i]!.upid) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type FinalistCompareFormat = {
  candidatesBlock: string;
  entries: Array<{ imageRef: string; productId: string }>;
};

function formatOneVerifiedForCompare(
  vc: VerifiedCandidate,
  index: number,
): { block: string; entry: { imageRef: string; productId: string } } {
  const judgeDetail = vc.judgeDetail ?? vc.detail;
  const ratingLine = ratingLineFromDetail(judgeDetail);
  const a = vc.availability;
  const availabilityLine = a
    ? [
        a.status === "in_stock"
          ? "in stock"
          : a.status === "running_low"
            ? "running low"
            : a.status === "out_of_stock"
              ? "OUT OF STOCK"
              : "unknown",
        a.preferredMatched === true
          ? "buyer size available"
          : a.preferredMatched === false
            ? "buyer size NOT available"
            : null,
      ]
        .filter(Boolean)
        .join("; ")
    : undefined;
  const currency =
    vc.detail.variants?.[0]?.price?.currency ??
    judgeDetail.variants?.[0]?.price?.currency ??
    "USD";
  const priceLabel = priceLabelFromCents(vc.resolvedPriceCents, currency);
  const imageRef = `candidate-${index}`;
  return {
    entry: { imageRef, productId: vc.detail.id },
    block: formatRichJudgmentCandidateBlock({
      id: vc.detail.id,
      title: judgeDetail.title ?? vc.detail.title ?? "",
      priceLabel,
      detail: judgeDetail,
      availabilityLine,
      ratingLine,
      listingHygieneLine: vc.listingHygiene
        ? formatListingHygieneLine(vc.listingHygiene)
        : undefined,
      imageRef,
    }),
  };
}

/** Single shuffle pass — text blocks and image_ref ids stay aligned for multimodal compare. */
export function formatFinalistsForCompare(
  verified: VerifiedCandidate[],
): FinalistCompareFormat {
  const shuffled = shuffleForJudgment(verified);
  const entries: FinalistCompareFormat["entries"] = [];
  const blocks: string[] = [];
  shuffled.forEach((vc, i) => {
    const formatted = formatOneVerifiedForCompare(vc, i);
    entries.push(formatted.entry);
    blocks.push(formatted.block);
  });
  return { candidatesBlock: blocks.join("\n\n"), entries };
}

export function formatVerifiedCandidatesForJudgment(
  verified: VerifiedCandidate[],
): string {
  return formatFinalistsForCompare(verified).candidatesBlock;
}

/** Compact blocks for phase-1 wide triage — title, price, key attrs only. */
export function formatVerifiedCandidatesForTriage(
  verified: VerifiedCandidate[],
): string {
  const shuffled = shuffleForJudgment(verified);
  return shuffled
    .map((vc, i) => {
      const detail = vc.judgeDetail ?? vc.detail;
      const currency = vc.detail.variants?.[0]?.price?.currency ?? "USD";
      const priceLabel = priceLabelFromCents(vc.resolvedPriceCents, currency);
      const candidate = judgmentCandidateFromDetail(detail, vc.resolvedPriceCents, {
        index: i,
        ratingLine: ratingLineFromDetail(detail),
        availabilityLine: vc.availability?.status === "out_of_stock"
          ? "OUT OF STOCK"
          : undefined,
      });
      const hygieneLine = vc.listingHygiene
        ? formatListingHygieneLine(vc.listingHygiene)
        : null;
      return [
        formatJudgmentCandidateBlock(candidate),
        hygieneLine ? `   listing_hygiene: ${hygieneLine}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function formatCardsForJudgment(cards: ShopifySearchProductCard[]): string {
  const shuffled = shuffleForJudgment(
    cards.map((c, i) => ({ ...c, upid: c.id || String(i) })),
  );
  return shuffled
    .map((card, i) => {
      const resolved = card.displayPrice ?? card.featuredVariant?.price;
      const priceLabel = resolved
        ? `${(resolved.amount / 100).toFixed(2)} ${resolved.currency}`
        : card.priceRange
          ? `${(card.priceRange.min.amount / 100).toFixed(2)} ${card.priceRange.min.currency}`
          : "price n/a";
      const a = card.availability;
      const availabilityLine = a
        ? [
            a.status === "in_stock"
              ? "in stock"
              : a.status === "running_low"
                ? "running low (limited stock)"
                : a.status === "out_of_stock"
                  ? "OUT OF STOCK"
                  : "stock unknown",
            a.preferredMatched === true
              ? "buyer's size/options available"
              : a.preferredMatched === false
                ? `buyer's exact pick NOT available (${a.relaxedNote ?? "relaxed"})`
                : null,
            a.shippable === true ? "ships to buyer" : null,
          ]
            .filter(Boolean)
            .join("; ")
        : undefined;
      const ratingLine = card.rating
        ? `${card.rating.value.toFixed(1)}/${card.rating.scaleMax} (${card.rating.count} reviews)`
        : undefined;
      const c: JudgmentCandidate = {
        id: card.id,
        title: card.title,
        priceLabel,
        attributes: card.catalogAttributes ?? extractCatalogAttributes(card),
        optionsLine: optionsLine(card.options),
        availabilityLine,
        ratingLine,
        imageRef: card.imageUrl ? `image-${i + 1}` : "no-image",
      };
      return formatJudgmentCandidateBlock(c);
    })
    .join("\n\n");
}
