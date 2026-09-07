import { taxonomyCategoriesForGarment } from "@/lib/fashion-memory/catalog-search/garment-taxonomy";
import {
  TARGET_GENDER_FILTER_VALUES,
  type PersonDepartment,
} from "@/lib/fashion-memory/department";
import { resolveColorDeterministic } from "@/lib/fashion-memory/normalize/color";
import type { ColorBucket } from "@/lib/fashion-memory/normalize/types";
import type {
  ColorFamily,
  ContractPiece,
  GarmentType,
} from "@/lib/photo-analysis/style-contract";
import type {
  CatalogProductSummary,
  CatalogSearchFilters,
  CatalogSearchResult,
  CatalogVariantSummary,
} from "@/lib/shopify/catalog";
import { spendTierFor, taxonomyColorValues } from "./color-values";

export const LOOKS_SEARCH_LIMIT = 24;
export const SWATCH_SEARCH_LIMIT = 30;
const SURVIVOR_CAP = 6;
const MIN_SURVIVORS = 2;

export type RetrieveCtx = {
  dept: PersonDepartment | null;
  country?: string | null;
  spendTier?: string | null;
  honestyIrrelevant?: string[];
  vetoes?: string[];
  brandAvoid?: string[];
  hardNegatives?: string[];
};

export type RetrieveSearch = (
  query: string,
  filters: CatalogSearchFilters,
  options: {
    limit: number;
    context?: { intent?: string; address_country?: string; currency?: string };
  },
) => Promise<CatalogSearchResult>;

export type PieceCandidate = {
  product: CatalogProductSummary;
  fromColorFilter: boolean;
  matchedColorLabel: string | null;
  needsVisualColorCheck: boolean;
  variantId: string | null;
};

const GARMENT_LABEL: Record<GarmentType, string> = {
  tee: "tee",
  polo: "polo",
  shirt: "shirt",
  overshirt: "overshirt",
  knit: "knit",
  sweatshirt: "sweatshirt",
  hoodie: "hoodie",
  blouse: "blouse",
  tank: "tank",
  bodysuit: "bodysuit",
  jeans: "jeans",
  chinos: "chinos",
  trousers: "trousers",
  shorts: "shorts",
  skirt: "skirt",
  blazer: "blazer",
  jacket: "jacket",
  coat: "coat",
  trench: "trench",
  cardigan: "cardigan",
  dress: "dress",
  jumpsuit: "jumpsuit",
  shirt_dress: "shirt dress",
  sneakers: "sneakers",
  loafers: "loafers",
  boots: "boots",
  sandals: "sandals",
  heels: "heels",
  dress_shoes: "dress shoes",
};

export function garmentLabel(type: GarmentType): string {
  return GARMENT_LABEL[type];
}

/** 3–5 word query: shade + garment. Descriptors never go here. */
export function searchQueryFor(piece: ContractPiece): string {
  const shade = piece.shade.replace(/\s+/g, " ").trim();
  const garment = garmentLabel(piece.garment_type);
  const words = `${shade} ${garment}`.split(/\s+/).filter(Boolean).slice(0, 5);
  return words.join(" ");
}

export function pieceIntent(piece: ContractPiece): string {
  const bits = [
    piece.fit ? `${piece.fit}-fit` : null,
    piece.neckline ? `${piece.neckline} neck` : null,
    ...piece.must_have,
    piece.must_not.length ? `no ${piece.must_not.join(", ")}` : null,
  ].filter(Boolean);
  return bits.join(", ") || searchQueryFor(piece);
}

export function colorOptionLabel(opts: Array<{ name: string; label: string }> | undefined): string | null {
  const hit = opts?.find((o) => /^colou?r$/i.test(o.name));
  return hit?.label?.trim() || null;
}

export function familyFromColorLabel(label: string): ColorBucket | null {
  const resolved = resolveColorDeterministic(label);
  return resolved.buckets[0] ?? null;
}

function colorOptionOnProduct(product: CatalogProductSummary): {
  labels: string[];
  hasColor: boolean;
} {
  const fromOptions =
    product.options?.find((o) => /^colou?r$/i.test(o.name))?.values.map((v) => v.label) ?? [];
  const fromVariants = (product.variants ?? [])
    .map((v) => colorOptionLabel(v.options))
    .filter((s): s is string => Boolean(s));
  const labels = [...new Set([...fromOptions, ...fromVariants].map((s) => s.trim()).filter(Boolean))];
  return { labels, hasColor: labels.length > 0 };
}

export function variantColorPass(
  product: CatalogProductSummary,
  family: ColorFamily,
): { ok: boolean; matchedLabel: string | null; needsVisualColorCheck: boolean; variantId: string | null } {
  const { labels, hasColor } = colorOptionOnProduct(product);
  if (!hasColor) {
    return { ok: true, matchedLabel: null, needsVisualColorCheck: true, variantId: null };
  }
  const matched = labels.find((label) => familyFromColorLabel(label) === family);
  if (!matched) {
    return { ok: false, matchedLabel: null, needsVisualColorCheck: false, variantId: null };
  }
  const variant =
    product.variants?.find((v) => colorOptionLabel(v.options) === matched) ??
    product.variants?.[0] ??
    null;
  return {
    ok: true,
    matchedLabel: matched,
    needsVisualColorCheck: false,
    variantId: variant?.id ?? null,
  };
}

function haystack(product: CatalogProductSummary): string {
  const attrs = product.metadata?.attributes;
  const attrText =
    typeof attrs === "string"
      ? attrs
      : attrs && typeof attrs === "object"
        ? JSON.stringify(attrs)
        : "";
  return `${product.title ?? ""} ${attrText}`.toLowerCase();
}

export function vetoPass(
  product: CatalogProductSummary,
  piece: ContractPiece,
  extra: { vetoes?: string[]; brandAvoid?: string[]; hardNegatives?: string[]; honestyIrrelevant?: string[] },
): boolean {
  const hay = haystack(product);
  const terms = [
    ...piece.must_not,
    ...(extra.vetoes ?? []),
    ...(extra.hardNegatives ?? []),
  ]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);
  for (const term of terms) {
    if (hay.includes(term)) return false;
  }
  const skip = new Set((extra.honestyIrrelevant ?? []).map((s) => s.toLowerCase()));
  const seller = sellerName(product);
  if (seller && extra.brandAvoid?.some((b) => seller.includes(b.toLowerCase()) && !skip.has(b.toLowerCase()))) {
    return false;
  }
  return true;
}

function sellerName(product: CatalogProductSummary): string {
  const fromVariant = product.variants?.find((v) => v.id)?.id
    ? ((product.variants?.[0] as CatalogVariantSummary & { seller?: { name?: string } })?.seller?.name ?? "")
    : "";
  const root = (product as CatalogProductSummary & { seller?: { name?: string } }).seller?.name ?? "";
  return `${fromVariant} ${root}`.toLowerCase();
}

export function productCategoryIds(product: CatalogProductSummary): string[] {
  const out: string[] = [];
  for (const c of product.categories ?? []) {
    if (typeof c === "string" && c.trim()) out.push(c.trim());
    else if (c && typeof c === "object" && typeof c.id === "string") out.push(c.id);
  }
  return out;
}

export function typeSanityPass(product: CatalogProductSummary, gids: string[]): boolean {
  if (!gids.length) return false;
  const ids = productCategoryIds(product);
  if (!ids.length) return true;
  return ids.some((id) => gids.includes(id));
}

export function prefilterCandidates(
  products: CatalogProductSummary[],
  piece: ContractPiece,
  gids: string[],
  fromColorFilter: Set<string>,
  extra: RetrieveCtx,
): PieceCandidate[] {
  const out: PieceCandidate[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    if (!product.id || seen.has(product.id)) continue;
    seen.add(product.id);
    if (!typeSanityPass(product, gids)) continue;
    if (!vetoPass(product, piece, extra)) continue;
    const color = variantColorPass(product, piece.color_family);
    if (!color.ok) continue;
    out.push({
      product,
      fromColorFilter: fromColorFilter.has(product.id),
      matchedColorLabel: color.matchedLabel,
      needsVisualColorCheck: color.needsVisualColorCheck,
      variantId: color.variantId,
    });
  }
  out.sort((a, b) => Number(b.fromColorFilter) - Number(a.fromColorFilter));
  return out.slice(0, SURVIVOR_CAP);
}

function dedupeByProduct(products: CatalogProductSummary[]): CatalogProductSummary[] {
  const seen = new Set<string>();
  const out: CatalogProductSummary[] = [];
  for (const p of products) {
    if (!p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function baseFilters(piece: ContractPiece, ctx: RetrieveCtx, gids: string[]): CatalogSearchFilters {
  const gender = ctx.dept ? TARGET_GENDER_FILTER_VALUES[ctx.dept] : null;
  const country = ctx.country?.trim().toUpperCase();
  const ships =
    country && /^[A-Z]{2}$/.test(country) ? { ships_to: { country } } : {};
  const attributes: NonNullable<CatalogSearchFilters["attributes"]> = [];
  if (gender?.length) {
    attributes.push({ name: "Target gender", values: [...gender] });
  }
  const price_tier = spendTierFor(ctx.spendTier);
  return {
    available: true,
    categories: gids,
    ...ships,
    ...(price_tier ? { price_tier } : {}),
    ...(attributes.length ? { attributes } : {}),
  };
}

async function searchFamily(
  search: RetrieveSearch,
  piece: ContractPiece,
  family: ColorFamily,
  ctx: RetrieveCtx,
): Promise<PieceCandidate[]> {
  const gids = taxonomyCategoriesForGarment(piece.garment_type);
  if (!gids.length) return [];
  const query = searchQueryFor({ ...piece, color_family: family });
  const intent = pieceIntent({ ...piece, color_family: family });
  const country = ctx.country?.trim().toUpperCase();
  const base = baseFilters({ ...piece, color_family: family }, ctx, gids);
  const colorValues = taxonomyColorValues(family);
  const withColor: CatalogSearchFilters = {
    ...base,
    attributes: [
      ...(base.attributes ?? []),
      { name: "Color", values: colorValues },
    ],
  };
  const context = {
    intent,
    ...(country && /^[A-Z]{2}$/.test(country) ? { address_country: country } : {}),
  };
  const [filtered, unfiltered] = await Promise.all([
    search(query, withColor, { limit: LOOKS_SEARCH_LIMIT, context }),
    search(query, base, { limit: LOOKS_SEARCH_LIMIT, context }),
  ]);
  const filteredIds = new Set((filtered.products ?? []).map((p) => p.id).filter(Boolean));
  const merged = dedupeByProduct([
    ...(filtered.products ?? []),
    ...(unfiltered.products ?? []),
  ]);
  return prefilterCandidates(merged, { ...piece, color_family: family }, gids, filteredIds, ctx);
}

export type RetrieveResult =
  | { ok: true; candidates: PieceCandidate[]; usedFallback: boolean }
  | { ok: false; dropReason: "no_catalog_match" | "no_taxonomy"; candidates: PieceCandidate[] };

export async function retrieveCandidates(
  piece: ContractPiece,
  ctx: RetrieveCtx,
  search: RetrieveSearch,
): Promise<RetrieveResult> {
  const gids = taxonomyCategoriesForGarment(piece.garment_type);
  if (!gids.length) {
    return { ok: false, dropReason: "no_taxonomy", candidates: [] };
  }
  const primary = await searchFamily(search, piece, piece.color_family, ctx);
  if (primary.length >= MIN_SURVIVORS) {
    return { ok: true, candidates: primary, usedFallback: false };
  }
  if (piece.fallback_family && piece.fallback_family !== piece.color_family) {
    const fallback = await searchFamily(search, piece, piece.fallback_family, ctx);
    if (fallback.length >= MIN_SURVIVORS) {
      return { ok: true, candidates: fallback, usedFallback: true };
    }
  }
  return { ok: false, dropReason: "no_catalog_match", candidates: primary };
}
