/**
 * Deterministic taste_fit diagnostic (S0).
 *
 * Not a scoring weight. For each hero, the share of the recipient's active
 * taste signals (color, style, silhouette, material, pattern, brand,
 * aesthetic) that the product's known attributes match (+1) or contradict (−1).
 * Unknown product attributes are skipped (never penalized).
 *
 * Range: −1..1. Mean per search is logged; live v3 vs v4 is the S0/S1 pair.
 */
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { COLOR_BUCKETS, type ColorBucket } from "../normalize/types";
import { allowedBucketsForConstraint } from "./palette-match";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { StyleSignalType } from "../types";

export const TASTE_FIT_SIGNAL_TYPES: readonly StyleSignalType[] = [
  "color",
  "style",
  "silhouette",
  "material",
  "pattern",
  "brand",
  "aesthetic",
] as const;

export type TasteFitSignal = {
  signal_type: StyleSignalType | string;
  value: string;
  polarity: number;
  source?: string;
  value_canonical?: string | null;
};

export type ProductTasteAttributes = {
  color: string[];
  style: string[];
  silhouette: string[];
  material: string[];
  pattern: string[];
  brand: string[];
  aesthetic: string[];
};

export type HeroTasteFit = {
  product_id: string;
  slot_id: string;
  taste_fit: number | null;
  considered: number;
  matched: number;
  contradicted: number;
};

const COLOR_BUCKET_SET = new Set<string>(COLOR_BUCKETS);

const ATTR_NAME_TO_TYPE: Record<string, keyof ProductTasteAttributes> = {
  color: "color",
  colour: "color",
  style: "style",
  silhouette: "silhouette",
  fit: "silhouette",
  material: "material",
  fabric: "material",
  pattern: "pattern",
  print: "pattern",
  brand: "brand",
  vendor: "brand",
  aesthetic: "aesthetic",
};

const SILHOUETTE_WORDS = [
  "slim",
  "relaxed",
  "oversized",
  "tailored",
  "boxy",
  "straight",
  "wide",
  "cropped",
  "fitted",
];
const PATTERN_WORDS = [
  "stripe",
  "striped",
  "check",
  "plaid",
  "floral",
  "solid",
  "logo",
  "graphic",
  "print",
  "paisley",
];
const MATERIAL_WORDS = [
  "linen",
  "cotton",
  "wool",
  "silk",
  "leather",
  "cashmere",
  "denim",
  "polyester",
  "nylon",
  "viscose",
  "merino",
];
const AESTHETIC_WORDS = [
  "minimal",
  "minimalist",
  "streetwear",
  "classic",
  "preppy",
  "quiet luxury",
  "old money",
  "sporty",
  "romantic",
];

export function classifyTasteToken(value: string): StyleSignalType {
  const v = norm(value);
  if (!v) return "style";
  if (COLOR_BUCKET_SET.has(v) || EXTRA_COLOR_WORDS.has(v)) return "color";
  if (SILHOUETTE_WORDS.includes(v)) return "silhouette";
  if (MATERIAL_WORDS.includes(v)) return "material";
  if (PATTERN_WORDS.includes(v)) return "pattern";
  if (AESTHETIC_WORDS.includes(v) || v.includes("luxury")) return "aesthetic";
  return "style";
}

const EXTRA_COLOR_WORDS = new Set([
  "camel",
  "neon",
  "charcoal",
  "cream",
  "ivory",
  "khaki",
  "taupe",
  "metallic",
]);

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

function pushUnique(arr: string[], value: string): void {
  const v = norm(value);
  if (!v || arr.includes(v)) return;
  arr.push(v);
}

function harvestTitleWords(
  title: string,
  words: string[],
  into: string[],
): void {
  const t = ` ${norm(title).replace(/[^a-z0-9]+/g, " ")} `;
  for (const w of words) {
    if (t.includes(` ${w} `)) pushUnique(into, w);
  }
}

/** Pull known taste attributes from a catalog product. Empty type = unknown. */
export function extractProductTasteAttributes(
  product: Pick<
    FashionSlotCatalogProduct,
    "title" | "normalized" | "raw" | "shop_domain" | "merchant_id"
  >,
): ProductTasteAttributes {
  const out: ProductTasteAttributes = {
    color: [],
    style: [],
    silhouette: [],
    material: [],
    pattern: [],
    brand: [],
    aesthetic: [],
  };

  for (const b of product.normalized?.colors?.buckets ?? []) {
    if (b !== "unknown") pushUnique(out.color, b);
  }

  for (const attr of extractCatalogAttributes(product.raw)) {
    const key = ATTR_NAME_TO_TYPE[norm(attr.name)];
    if (key) pushUnique(out[key], attr.value);
  }

  const title = product.title ?? "";
  harvestTitleWords(title, SILHOUETTE_WORDS, out.silhouette);
  harvestTitleWords(title, PATTERN_WORDS, out.pattern);
  harvestTitleWords(title, MATERIAL_WORDS, out.material);
  harvestTitleWords(title, AESTHETIC_WORDS, out.aesthetic);
  const titleNorm = ` ${norm(title)} `;
  for (const b of COLOR_BUCKETS) {
    if (b === "unknown" || b === "multi" || b === "print") continue;
    if (titleNorm.includes(` ${b} `)) pushUnique(out.color, b);
  }

  const domain = product.shop_domain?.replace(/\.[a-z]+$/i, "") ?? "";
  if (domain) pushUnique(out.brand, domain.replace(/-/g, " "));
  return out;
}

function signalType(
  raw: string,
): keyof ProductTasteAttributes | null {
  const t = norm(raw);
  if ((TASTE_FIT_SIGNAL_TYPES as readonly string[]).includes(t)) {
    return t as keyof ProductTasteAttributes;
  }
  return null;
}

function colorMatches(productColors: string[], signalValue: string): boolean | null {
  if (!productColors.length) return null;
  const wanted = allowedBucketsForConstraint(signalValue);
  if (!wanted.size) {
    const token = norm(signalValue);
    if (COLOR_BUCKET_SET.has(token)) {
      return productColors.includes(token);
    }
    return productColors.some((c) => c.includes(token) || token.includes(c));
  }
  const product = new Set(productColors.filter((c): c is ColorBucket => COLOR_BUCKET_SET.has(c)));
  for (const b of product) {
    if (wanted.has(b)) return true;
  }
  return false;
}

function textMatches(productValues: string[], signalValue: string): boolean | null {
  if (!productValues.length) return null;
  const sig = norm(signalValue);
  const sigTokens = tokens(sig);
  for (const v of productValues) {
    if (v === sig || v.includes(sig) || sig.includes(v)) return true;
    if (sigTokens.some((t) => v.includes(t))) return true;
  }
  return false;
}

function signalAgrees(
  attrs: ProductTasteAttributes,
  signal: TasteFitSignal,
): boolean | null {
  const type = signalType(signal.signal_type);
  if (!type) return null;
  const value = (signal.value_canonical ?? signal.value).trim();
  if (type === "color") return colorMatches(attrs.color, value);
  return textMatches(attrs[type], value);
}

/**
 * −1..1, or null when no signal could be scored (no relevant signals, or all
 * product attributes unknown for those types).
 */
export function tasteFitForProduct(
  product: Pick<
    FashionSlotCatalogProduct,
    "title" | "normalized" | "raw" | "shop_domain" | "merchant_id"
  >,
  signals: TasteFitSignal[],
): { taste_fit: number | null; considered: number; matched: number; contradicted: number } {
  const attrs = extractProductTasteAttributes(product);
  let sum = 0;
  let considered = 0;
  let matched = 0;
  let contradicted = 0;

  for (const signal of signals) {
    if (!signalType(signal.signal_type)) continue;
    const agrees = signalAgrees(attrs, signal);
    if (agrees == null) continue;
    const like = signal.polarity >= 0;
    const isMatch = like ? agrees : !agrees;
    considered += 1;
    if (isMatch) {
      sum += 1;
      matched += 1;
    } else {
      sum -= 1;
      contradicted += 1;
    }
  }

  if (!considered) return { taste_fit: null, considered: 0, matched: 0, contradicted: 0 };
  return {
    taste_fit: Math.round((sum / considered) * 1000) / 1000,
    considered,
    matched,
    contradicted,
  };
}

export function meanTasteFit(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

export function tasteFitForHeroes(params: {
  heroes: Array<{
    product_id: string;
    slot_id: string;
    product: Pick<
      FashionSlotCatalogProduct,
      "title" | "normalized" | "raw" | "shop_domain" | "merchant_id"
    >;
  }>;
  signals: TasteFitSignal[];
  preference_anchor?: string | null;
}): {
  preference_anchor: string | null;
  heroes: HeroTasteFit[];
  mean: number | null;
} {
  const heroes = params.heroes.map((h) => {
    const r = tasteFitForProduct(h.product, params.signals);
    return {
      product_id: h.product_id,
      slot_id: h.slot_id,
      taste_fit: r.taste_fit,
      considered: r.considered,
      matched: r.matched,
      contradicted: r.contradicted,
    };
  });
  return {
    preference_anchor: params.preference_anchor ?? null,
    heroes,
    mean: meanTasteFit(heroes.map((h) => h.taste_fit)),
  };
}
