/**
 * Recognizable anchor brands — every rack needs 1–2 trusted names plus room for a gem.
 * Long-tail-only pools read as dropshipping, not curation.
 */
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { detectShoppingCategoryFromQuery } from "../shopping-memory/category-detector";

const FASHION_ANCHORS = [
  "calvin klein",
  "j.crew",
  "j crew",
  "bonobos",
  "theory",
  "hugo boss",
  "brooks brothers",
  "banana republic",
  "uniqlo",
  "everlane",
  "suitsupply",
  "ted baker",
  "ralph lauren",
  "nordstrom",
  "club monaco",
  "reiss",
  "indochino",
];

const FOOTWEAR_ANCHORS = [
  "nike",
  "adidas",
  "new balance",
  "brooks",
  "asics",
  "salomon",
  "hoka",
  "on running",
  "clarks",
  "cole haan",
];

const TECH_ANCHORS = [
  "apple",
  "samsung",
  "sony",
  "bose",
  "anker",
  "logitech",
  "dell",
  "lenovo",
];

const BEAUTY_ANCHORS = [
  "cerave",
  "la roche-posay",
  "paula's choice",
  "the ordinary",
  "clinique",
  "estee lauder",
];

const HOME_ANCHORS = [
  "le creuset",
  "kitchenaid",
  "dyson",
  "casper",
  "brooklinen",
  "west elm",
  "crate and barrel",
];

const CATEGORY_ANCHORS: Record<string, string[]> = {
  fashion: FASHION_ANCHORS,
  apparel: FASHION_ANCHORS,
  footwear: FOOTWEAR_ANCHORS,
  tech: TECH_ANCHORS,
  beauty: BEAUTY_ANCHORS,
  home: HOME_ANCHORS,
};

export function anchorBrandsForQuery(query: string, category?: string): string[] {
  const detected = detectShoppingCategoryFromQuery(query);
  const keys = [category?.toLowerCase(), ...detected.map((d) => d.toLowerCase())].filter(
    Boolean,
  ) as string[];
  const out = new Set<string>();
  for (const key of keys) {
    for (const [cat, brands] of Object.entries(CATEGORY_ANCHORS)) {
      if (key.includes(cat) || cat.includes(key)) {
        for (const b of brands) out.add(b);
      }
    }
  }
  if (/\bblazer|jacket|suit|dress shirt\b/i.test(query)) {
    for (const b of FASHION_ANCHORS) out.add(b);
  }
  if (/\bshoe|sneaker|boot\b/i.test(query)) {
    for (const b of FOOTWEAR_ANCHORS) out.add(b);
  }
  return [...out];
}

function brandTextFromProduct(product: CatalogProductSummary): string {
  const parts = [product.title ?? ""];
  for (const a of extractCatalogAttributes(product)) {
    if (/brand/i.test(a.name)) parts.push(a.value);
  }
  const raw = product as unknown as Record<string, unknown>;
  const seller = raw.seller as { name?: string; domain?: string } | undefined;
  if (seller?.name) parts.push(seller.name);
  if (seller?.domain) parts.push(seller.domain.replace(/^www\./i, "").split(".")[0] ?? "");
  return parts.join(" ").toLowerCase();
}

export function isAnchorBrandProduct(
  product: CatalogProductSummary,
  query: string,
  category?: string,
): boolean {
  const hay = brandTextFromProduct(product);
  const anchors = anchorBrandsForQuery(query, category);
  return anchors.some((a) => hay.includes(a));
}

/** Broader recognizable brands — anchor is category-scoped; known is global literacy. */
const GLOBAL_KNOWN_BRANDS = [
  ...new Set([
    ...FASHION_ANCHORS,
    ...FOOTWEAR_ANCHORS,
    ...TECH_ANCHORS,
    ...BEAUTY_ANCHORS,
    ...HOME_ANCHORS,
    "nike",
    "adidas",
    "zara",
    "hm",
    "h&m",
    "gap",
    "old navy",
    "target",
    "amazon",
    "north face",
    "patagonia",
    "lululemon",
    "under armour",
    "puma",
    "vans",
    "converse",
    "timberland",
    "dr martens",
    "skechers",
    "michael kors",
    "coach",
    "kate spade",
    "fossil",
    "garmin",
    "fitbit",
    "google",
    "microsoft",
    "hp",
    "canon",
    "nikon",
    "lg",
    "philips",
    "nestle",
    "nintendo",
    "playstation",
    "xbox",
    "dyson",
    "shark",
    "instant pot",
    "oxo",
    "all-clad",
    "nordstrom",
    "macys",
    "bar iii",
    "alfani",
    "tommy hilfiger",
    "levi's",
    "levis",
    "dockers",
    "columbia",
    "carhartt",
  ]),
];

export type BrandTier = "anchor" | "known" | "unknown";

export function isKnownBrandProduct(
  product: CatalogProductSummary,
  query?: string,
  category?: string,
): boolean {
  if (query && isAnchorBrandProduct(product, query, category)) return true;
  const hay = brandTextFromProduct(product);
  return GLOBAL_KNOWN_BRANDS.some((b) => hay.includes(b));
}

export function classifyBrandTier(
  product: CatalogProductSummary,
  query: string,
  category?: string,
): BrandTier {
  if (isAnchorBrandProduct(product, query, category)) return "anchor";
  if (isKnownBrandProduct(product, query, category)) return "known";
  return "unknown";
}

/** Scoring bonus so anchors surface before anonymous long-tail. */
export const ANCHOR_BRAND_SCORE_BONUS = 0.09;

/** Portfolio seed: one anchor-branded query per search when possible. */
export function anchorPortfolioQueryText(
  brief: { query: string; category?: string; mustHaves?: string[] },
): string | null {
  const anchors = anchorBrandsForQuery(brief.query, brief.category);
  if (!anchors.length) return null;
  const anchor = anchors[0]!;
  const noun = brief.query
    .replace(/\b(men'?s?|women'?s?)\b/gi, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
  if (!noun) return null;
  return `${anchor} ${noun}`.trim();
}
