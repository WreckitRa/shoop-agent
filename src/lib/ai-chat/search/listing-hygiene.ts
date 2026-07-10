/**
 * Deterministic listing hygiene — cheap tells before any model sees candidates.
 * Regex flags attach to candidate records; reliable patterns can graduate to merchant scoring.
 */
import { parseCatalogRating, type CatalogProductDetail } from "@/lib/shopify/catalog";
import { logAiChat } from "../observability";
import { classifyBrandTier, type BrandTier } from "./brand-anchors";
import { resolveListingTrustForSuspects } from "./listing-hygiene-llm";
import type { ConstraintGateDrop, ConstraintGateMetrics } from "./constraint-gate";
import type { SearchBrief } from "./types";
import type { VerifiedCandidate } from "./verify";

export type ListingHygieneFlag =
  | "single_size_clearance"
  | "sku_title"
  | "thin_reviews"
  | "dropship_tell"
  | "price_anomaly"
  | "single_variant";

export type ListingQuality = "clean" | "suspect" | "junk";

export type ListingHygiene = {
  quality: ListingQuality;
  flags: ListingHygieneFlag[];
  brandTier: BrandTier;
  /** Named seller + domain (or strong catalog signals). */
  merchantEstablished?: boolean;
  /** Human-readable lines for prompts and narration. */
  notes: string[];
};

/** Size embedded in title — often single-size clearance (e.g. "36 S", "46 L"). */
const SIZE_IN_TITLE_RE =
  /\b(?:size\s*)?(?:\d{2}\s*(?:S|M|L|XL|XXL|XS|2XL|3XL)|(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL)\s*[-–]\s*\d{2})\b/i;

/** Alphanumeric SKU blobs in titles (e.g. "70290625M"). */
const SKU_TITLE_RE = /\b(?:[A-Z]{0,3}\d{6,}[A-Z]?|\d{8,}[A-Z]?)\b/;

/** Title is mostly SKU / model number with little natural language. */
const SKU_HEAVY_TITLE_RE = /^[\dA-Z][\dA-Z\s\-_/]{10,}$/i;

const GENERIC_DROPSHIP_TITLE_RE =
  /\b(?:free shipping|100% brand new|high quality|hot sale|best seller)\b/i;

/** Dictionary words common in real product titles (not bare SKU blobs). */
const PRODUCT_TITLE_WORD_RE =
  /\b(jacket|blazer|coat|suit|shirt|pants|dress|shoe|sneaker|boot|bag|watch|belt|tie|vest|hoodie|sweater|cardigan|parka|bomber|trouser|chino|denim|tee|top|skirt|gown|ring|necklace|earring|bracelet|black|white|navy|gray|grey|blue|brown|beige|olive|mens|men|women|womens|wool|leather|cotton|linen|silk|stretch|flex|pro|max|ultra|classic|slim|regular|fit|tailored|performance|merino|cashmere)\b/i;

/** Category keyword → minimum plausible price in minor units (USD-ish). */
const PRICE_FLOOR_HINTS: Array<{ pattern: RegExp; minCents: number; label: string }> = [
  { pattern: /\bwool\b.*\bblazer\b|\bblazer\b.*\bwool\b/i, minCents: 4500, label: "wool blazer" },
  { pattern: /\bblazer\b|\bsport coat\b|\bsuit jacket\b/i, minCents: 3500, label: "blazer" },
  { pattern: /\bleather\b.*\bjacket\b|\bjacket\b.*\bleather\b/i, minCents: 8000, label: "leather jacket" },
  { pattern: /\brunning shoe\b|\bsneaker\b|\btrainer\b/i, minCents: 4000, label: "sneaker" },
  { pattern: /\bsony\b|\bbose\b|\bapple\b/i, minCents: 1500, label: "name-brand electronics" },
];

function titleText(detail: CatalogProductDetail): string {
  return (detail.title ?? "").trim();
}

function resolveSeller(
  detail: CatalogProductDetail,
): { name?: string; domain?: string; url?: string } | undefined {
  return detail.seller ?? detail.variants?.find((v) => v.seller)?.seller;
}

/** True when catalog shows a named merchant with domain or strong listing depth. */
export function hasEstablishedMerchant(detail: CatalogProductDetail): boolean {
  const seller = resolveSeller(detail);
  const name = seller?.name?.trim();
  const domain = seller?.domain?.trim();
  if (!name || !domain) return false;

  const sizeOpt = detail.options?.find((o) => /size/i.test(o.name));
  const sizeCount = sizeOpt?.values?.length ?? 0;
  if (sizeCount >= 2) return true;

  const r = parseCatalogRating(detail.rating);
  if (r && (r.count ?? 0) >= 10) return true;

  return true;
}

function variantCount(detail: CatalogProductDetail): number {
  return detail.variants?.length ?? 0;
}

function isSingleVariantListing(detail: CatalogProductDetail): boolean {
  if (variantCount(detail) !== 1) return false;
  const options = detail.options ?? [];
  if (!options.length) return true;
  return options.every((o) => (o.values?.length ?? 0) <= 1);
}

function productTitleWordCount(title: string): number {
  const words = title.split(/\s+/).filter(Boolean);
  return words.filter((w) => PRODUCT_TITLE_WORD_RE.test(w)).length;
}

function hasSizeInTitle(title: string): boolean {
  return SIZE_IN_TITLE_RE.test(title);
}

function hasSkuHeavyTitle(title: string): boolean {
  const collapsed = title.replace(/\s+/g, "");
  if (collapsed.length < 10) return false;
  if (productTitleWordCount(title) >= 2) return false;
  if (!/\d/.test(collapsed) && !SKU_TITLE_RE.test(title)) {
    if (/^[a-zA-Z]+$/.test(collapsed)) return false;
  }
  return SKU_HEAVY_TITLE_RE.test(collapsed);
}

export function hasSkuTitle(title: string): boolean {
  if (SKU_TITLE_RE.test(title)) return true;
  if (hasSkuHeavyTitle(title)) return true;
  const words = title.split(/\s+/).filter(Boolean);
  const skuLike = words.filter((w) => /^\d{6,}[A-Z]?$/.test(w));
  return skuLike.length >= 1 && words.length <= 6;
}

function hasThinReviews(detail: CatalogProductDetail): boolean {
  const r = parseCatalogRating(detail.rating);
  if (!r) return false;
  const count = r.count ?? 0;
  const scale = r.scaleMax || 5;
  const perfect = r.value / scale >= 0.98;
  return (count > 0 && count < 30 && perfect) || count < 5;
}

function hasDropshipTell(
  detail: CatalogProductDetail,
  brandTier: BrandTier,
  title: string,
  skuFlagged: boolean,
): boolean {
  if (!title) return false;
  if (hasEstablishedMerchant(detail)) return false;
  if (brandTier !== "unknown") return false;
  if (GENERIC_DROPSHIP_TITLE_RE.test(title)) return true;
  if (skuFlagged && productTitleWordCount(title) < 2 && title.split(/\s+/).length <= 4) {
    return true;
  }
  const alphaWords = title.match(/[a-z]{3,}/gi) ?? [];
  return alphaWords.length <= 1 && /\d/.test(title);
}

function priceAnomalyFlag(
  detail: CatalogProductDetail,
  brief: SearchBrief,
  priceCents: number | null | undefined,
): ListingHygieneFlag | null {
  const cents = priceCents ?? null;
  if (cents == null || cents <= 0) return null;
  const hay = `${brief.query} ${titleText(detail)}`.toLowerCase();
  for (const hint of PRICE_FLOOR_HINTS) {
    if (!hint.pattern.test(hay)) continue;
    if (cents < hint.minCents) return "price_anomaly";
  }
  return null;
}

/** Count severe flags for junk — dropship derived from sku-only titles does not stack. */
function independentSevereCount(
  flags: ListingHygieneFlag[],
  title: string,
): number {
  const severe = new Set<ListingHygieneFlag>([
    "sku_title",
    "single_size_clearance",
    "dropship_tell",
    "price_anomaly",
  ]);
  let count = 0;
  for (const f of flags) {
    if (!severe.has(f)) continue;
    if (
      f === "dropship_tell" &&
      flags.includes("sku_title") &&
      !GENERIC_DROPSHIP_TITLE_RE.test(title)
    ) {
      continue;
    }
    count += 1;
  }
  return count;
}

function classifyListingQuality(
  flags: ListingHygieneFlag[],
  brandTier: BrandTier,
  title: string,
  merchantEstablished: boolean,
): ListingQuality {
  const hasNumericSku = SKU_TITLE_RE.test(title);
  const hardClearance =
    flags.includes("single_size_clearance") &&
    (hasNumericSku || flags.includes("sku_title"));
  const genericDropship = GENERIC_DROPSHIP_TITLE_RE.test(title);

  if (hardClearance || genericDropship) return "junk";

  if (merchantEstablished) {
    if (hasNumericSku) return "junk";
    return flags.length ? "suspect" : "clean";
  }

  const severeCount = independentSevereCount(flags, title);
  if (
    severeCount >= 2 ||
    (flags.includes("sku_title") && flags.includes("single_size_clearance")) ||
    (flags.includes("price_anomaly") &&
      brandTier === "unknown" &&
      flags.includes("sku_title"))
  ) {
    return "junk";
  }
  if (flags.length) return "suspect";
  return "clean";
}

export function analyzeListingHygiene(
  detail: CatalogProductDetail,
  brief: SearchBrief,
  priceCents?: number | null,
): ListingHygiene {
  const title = titleText(detail);
  const brandTier = classifyBrandTier(detail, brief.query, brief.category);
  const merchantEstablished = hasEstablishedMerchant(detail);
  const flags: ListingHygieneFlag[] = [];
  const notes: string[] = [];

  if (hasSizeInTitle(title)) {
    flags.push("single_size_clearance");
    notes.push("size embedded in title — often single-size clearance");
  }
  if (hasSkuTitle(title)) {
    flags.push("sku_title");
    notes.push("SKU-style title — reseller/dropship listing");
  }
  if (isSingleVariantListing(detail)) {
    flags.push("single_variant");
    notes.push("single-variant listing");
  }
  if (hasThinReviews(detail)) {
    flags.push("thin_reviews");
    const r = parseCatalogRating(detail.rating);
    notes.push(
      r
        ? `${r.count} reviews at ${r.value.toFixed(1)}/${r.scaleMax} — weak social proof`
        : "very few reviews — weak social proof",
    );
  }
  const skuFlagged = flags.includes("sku_title");
  if (hasDropshipTell(detail, brandTier, title, skuFlagged)) {
    flags.push("dropship_tell");
    notes.push("generic/no-brand listing pattern");
  }
  const priceFlag = priceAnomalyFlag(detail, brief, priceCents);
  if (priceFlag) {
    flags.push(priceFlag);
    notes.push("price unusually low for this product type");
  }

  const quality = classifyListingQuality(
    flags,
    brandTier,
    title,
    merchantEstablished,
  );

  return { quality, flags, brandTier, merchantEstablished, notes };
}

export function formatListingHygieneLine(h: ListingHygiene): string {
  const flagPart = h.flags.length ? h.flags.join(", ") : "none";
  const merchant = h.merchantEstablished ? "established" : "unknown_merchant";
  return `listing: ${h.quality}; brand: ${h.brandTier}; merchant: ${merchant}; flags: ${flagPart}`;
}

/** Auto-drop deterministic junk before tier judge — saves tokens and blocks clearance racks. */
export function isDeterministicListingJunk(h: ListingHygiene): boolean {
  return h.quality === "junk";
}

export function listingHygieneDropReason(h: ListingHygiene): string {
  const top = h.notes[0] ?? h.flags.join(", ");
  return `clearance/junk listing (${top})`;
}

export function attachListingHygieneToVerified(
  verified: VerifiedCandidate[],
  brief: SearchBrief,
): VerifiedCandidate[] {
  return verified.map((vc) => ({
    ...vc,
    listingHygiene: analyzeListingHygiene(vc.detail, brief, vc.resolvedPriceCents),
  }));
}

/** Drop junk listings before tier judge; optional batched LLM on suspect rows. */
export async function applyListingHygieneGate(
  verified: VerifiedCandidate[],
  brief: SearchBrief,
  opts?: { signal?: AbortSignal },
): Promise<{ passed: VerifiedCandidate[]; metrics: ConstraintGateMetrics }> {
  let withHygiene = attachListingHygieneToVerified(verified, brief);

  const hygieneById = new Map(
    withHygiene.map((vc) => [vc.detail.id, vc.listingHygiene!]),
  );
  const resolvedHygiene = await resolveListingTrustForSuspects({
    verified: withHygiene,
    brief,
    hygieneById,
    signal: opts?.signal,
  });
  withHygiene = withHygiene.map((vc) => ({
    ...vc,
    listingHygiene: resolvedHygiene.get(vc.detail.id) ?? vc.listingHygiene,
  }));

  const drops: ConstraintGateDrop[] = [];
  const passed: VerifiedCandidate[] = [];

  for (const vc of withHygiene) {
    const h = vc.listingHygiene!;
    if (h.flags.length) {
      logAiChat("info", "listing_hygiene_flags", {
        query: brief.query.slice(0, 80),
        productId: vc.detail.id,
        title: (vc.detail.title ?? "").slice(0, 80),
        quality: h.quality,
        flags: h.flags,
        brandTier: h.brandTier,
        merchantEstablished: h.merchantEstablished ?? false,
      });
    }
    if (isDeterministicListingJunk(h)) {
      drops.push({
        productId: vc.detail.id,
        title: vc.detail.title ?? "",
        reason: listingHygieneDropReason(h),
        gate: "listing_hygiene",
      });
      continue;
    }
    passed.push(vc);
  }

  const dropsByGate: ConstraintGateMetrics["dropsByGate"] = {};
  for (const d of drops) {
    dropsByGate[d.gate] = (dropsByGate[d.gate] ?? 0) + 1;
  }

  if (drops.length) {
    logAiChat("info", "listing_hygiene_gate", {
      query: brief.query.slice(0, 120),
      input: withHygiene.length,
      output: passed.length,
      drops: drops.length,
    });
  }

  return {
    passed,
    metrics: {
      inputCount: withHygiene.length,
      outputCount: passed.length,
      drops,
      dropsByGate,
    },
  };
}
