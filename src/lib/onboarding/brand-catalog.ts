/**
 * Onboarding brand catalog (brands.csv) + per-user grid selection.
 *
 * Filter: dept × market. Then score, spread price bands, shuffle so rank
 * is not a prestige signal. Never show the full 110.
 */

import { normalizeShopifyCountryInput } from "@/lib/cart/countries";
import {
  genderPresentationBucket,
  type SuggestionAudience,
} from "@/lib/onboarding/form-options";
import type { LovesVetoesContext } from "@/lib/onboarding/loves-vetoes-suggest";
import seedJson from "./brand-catalog.json";

export const BRAND_GRID_SIZE = 28;
export const BRAND_TILE_DIR = "/onboarding/brands";

export type BrandDept = "Womenswear" | "Menswear" | "Both";

export type CatalogBrand = {
  id: string;
  name: string;
  dept: BrandDept;
  priceBand: number;
  composition: number;
  regions: string[];
  markets: string[];
  c1: string;
  c2: string;
  hasImage: boolean;
  source: "seed" | "user";
};

type SeedRow = Omit<CatalogBrand, "source">;

const SEED: CatalogBrand[] = (seedJson as SeedRow[]).map((row) => ({
  ...row,
  source: "seed",
}));

const SEED_BY_ID = new Map(SEED.map((b) => [b.id, b]));

const MENA = new Set([
  "AE",
  "SA",
  "QA",
  "KW",
  "BH",
  "OM",
  "EG",
  "JO",
  "LB",
  "IQ",
  "SY",
  "YE",
  "PS",
  "IL",
  "IR",
  "MA",
  "TN",
  "DZ",
  "LY",
]);

const EU = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "CH",
  "NO",
  "IS",
  "MC",
  "LI",
  "AD",
]);

/** CSV region tokens boosted when the shopper's earlier answers contain these. */
const REGION_HINTS: Array<{ needles: string[]; regions: string[] }> = [
  { needles: ["minimal", "quiet"], regions: ["minimalist", "quiet_luxury", "scandi_minimal"] },
  { needles: ["classic", "tailor", "blazer"], regions: ["timeless_classic", "corporate_polish", "sharp_tailoring"] },
  { needles: ["sport", "athleisure", "lulu"], regions: ["sporty", "athleisure"] },
  { needles: ["street"], regions: ["streetwear"] },
  { needles: ["denim", "jean"], regions: ["relaxed_denim"] },
  { needles: ["romantic", "paris", "french"], regions: ["romantic", "undone_french"] },
  { needles: ["preppy", "oxford"], regions: ["preppy", "ivy_collegiate"] },
  { needles: ["boho", "festival"], regions: ["boho", "festival"] },
  { needles: ["luxury", "designer"], regions: ["quiet_luxury", "old_money_worn"] },
  { needles: ["outdoor", "gorp", "linen"], regions: ["gorpcore", "rugged_outdoors"] },
  { needles: ["modest"], regions: ["modest_contemporary", "modest_classic"] },
  { needles: ["vintage"], regions: ["eclectic_vintage", "vintage_led"] },
  { needles: ["campus", "18_22"], regions: ["high_street_current", "skater"] },
];

export function brandSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function brandKey(name: string): string {
  return name.trim().toLowerCase();
}

function compactKey(name: string): string {
  return brandSlug(name).replace(/_/g, "");
}

export function tileSrc(brand: Pick<CatalogBrand, "id" | "hasImage">): string | null {
  if (!brand.hasImage) return null;
  return `${BRAND_TILE_DIR}/${brand.id}.jpg`;
}

export function seedCatalog(): CatalogBrand[] {
  return SEED;
}

export function communityBrand(name: string): CatalogBrand {
  const trimmed = name.trim().slice(0, 60);
  return {
    id: brandSlug(trimmed) || "custom",
    name: trimmed,
    dept: "Both",
    priceBand: 3,
    composition: 0.5,
    regions: [],
    markets: ["global"],
    c1: "#A8A8B0",
    c2: "#66666E",
    hasImage: false,
    source: "user",
  };
}

export function findSeedBrand(name: string): CatalogBrand | undefined {
  const slug = brandSlug(name);
  if (!slug) return undefined;
  const byId = SEED_BY_ID.get(slug);
  if (byId) return byId;
  const compact = compactKey(name);
  const exact = SEED.find(
    (b) =>
      brandKey(b.name) === brandKey(name) ||
      compactKey(b.name) === compact ||
      compactKey(b.id) === compact,
  );
  if (exact) return exact;
  if (compact.length < 5) return undefined;
  return SEED.find((b) => {
    const hay = compactKey(b.name);
    return hay.includes(compact) || compact.includes(hay);
  });
}

export function searchSeedBrands(query: string, limit = 12): CatalogBrand[] {
  const q = query.trim();
  if (!q) return [];
  const qKey = brandKey(q);
  const qCompact = compactKey(q);
  const scored: Array<{ brand: CatalogBrand; score: number }> = [];
  for (const b of SEED) {
    const name = brandKey(b.name);
    const compact = compactKey(b.name);
    let score = 0;
    if (name === qKey || compact === qCompact) score = 100;
    else if (name.startsWith(qKey) || compact.startsWith(qCompact)) score = 80;
    else if (name.includes(qKey) || compact.includes(qCompact)) score = 50;
    if (score) scored.push({ brand: b, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.brand.name.localeCompare(b.brand.name),
  );
  return scored.slice(0, limit).map((r) => r.brand);
}

export function brandMarket(country?: string): string {
  if (!country?.trim()) return "global";
  const code = normalizeShopifyCountryInput(country).toUpperCase();
  if (code === "GB" || code === "IE") return "uk";
  if (code === "US") return "us";
  if (code === "CA") return "canada";
  if (code === "AU" || code === "NZ") return "au";
  if (code === "TR") return "tr";
  if (MENA.has(code)) return "mena";
  if (EU.has(code)) return "eu";
  return "global";
}

function deptFits(dept: BrandDept, audience: SuggestionAudience | "any"): boolean {
  if (audience === "any") return true;
  if (dept === "Both") return true;
  if (audience === "masculine") return dept === "Menswear";
  return dept === "Womenswear";
}

function marketFits(markets: string[], userMarket: string): boolean {
  if (markets.includes("global")) return true;
  if (userMarket === "global") return markets.includes("global");
  return markets.includes(userMarket);
}

function audienceOf(ctx: LovesVetoesContext): SuggestionAudience | "any" {
  const bucket = genderPresentationBucket(ctx.genderPresentation);
  if (bucket === "masculine") return "masculine";
  if (bucket === "feminine") return "feminine";
  return "any";
}

function spendTarget(ctx: LovesVetoesContext): number {
  const vp = (ctx.valuePhilosophy ?? "").toLowerCase();
  if (vp.includes("luxury")) return 5;
  if (vp.includes("premium") || vp.includes("design_first")) return 4;
  if (vp.includes("deal") || vp.includes("best_value")) return 2;
  return 3;
}

function wantedRegions(ctx: LovesVetoesContext): Set<string> {
  const blobs = [
    ctx.styleEra,
    ctx.valuePhilosophy,
    ...(ctx.lifestyleTags ?? []),
    ...(ctx.wornLabels ?? []),
    ...(ctx.aspirationalLabels ?? []),
    ...(ctx.wornTasteTags ?? []),
    ...(ctx.aspirationalTasteTags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const out = new Set<string>();
  for (const hint of REGION_HINTS) {
    if (hint.needles.some((n) => blobs.includes(n))) {
      for (const r of hint.regions) out.add(r);
    }
  }
  return out;
}

function scoreBrand(
  brand: CatalogBrand,
  regions: Set<string>,
  targetBand: number,
): number {
  let score = 4 - Math.abs(brand.priceBand - targetBand);
  for (const r of brand.regions) {
    if (regions.has(r)) score += 3;
  }
  return score;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(ctx: LovesVetoesContext): number {
  const raw = [
    ctx.genderPresentation,
    ctx.shippingCountry,
    ctx.styleEra,
    ctx.valuePhilosophy,
  ]
    .filter(Boolean)
    .join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleInPlace<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

function applyPriceSpread(ranked: CatalogBrand[], limit: number): CatalogBrand[] {
  const seen = new Set<string>();
  const out: CatalogBrand[] = [];
  const take = (b: CatalogBrand) => {
    if (seen.has(b.id) || out.length >= limit) return;
    seen.add(b.id);
    out.push(b);
  };

  const budget = ranked.filter((b) => b.priceBand <= 2);
  for (const b of budget.slice(0, 2)) take(b);
  for (const b of ranked) take(b);

  if (new Set(out.map((b) => b.priceBand)).size < 3) {
    const missing = [1, 2, 3, 4, 5].filter(
      (band) => !out.some((b) => b.priceBand === band),
    );
    for (const band of missing) {
      const extra = ranked.find((b) => b.priceBand === band && !seen.has(b.id));
      if (!extra) continue;
      const drop = out.findIndex((b) =>
        out.filter((x) => x.priceBand === b.priceBand).length > 1,
      );
      if (drop >= 0) {
        seen.delete(out[drop]!.id);
        out.splice(drop, 1);
      }
      take(extra);
      if (new Set(out.map((b) => b.priceBand)).size >= 3) break;
    }
  }

  return out.slice(0, limit);
}

export function selectBrandsForUser(
  ctx: LovesVetoesContext,
  extras: CatalogBrand[] = [],
  limit = BRAND_GRID_SIZE,
): CatalogBrand[] {
  const audience = audienceOf(ctx);
  const market = brandMarket(ctx.shippingCountry);
  const regions = wantedRegions(ctx);
  const target = spendTarget(ctx);

  const eligible = SEED.filter(
    (b) => deptFits(b.dept, audience) && marketFits(b.markets, market),
  );
  const pool = eligible.length >= 8 ? eligible : SEED.filter((b) => deptFits(b.dept, audience));

  const ranked = [...pool].sort((a, b) => {
    const d = scoreBrand(b, regions, target) - scoreBrand(a, regions, target);
    if (d) return d;
    return a.name.localeCompare(b.name);
  });

  const picked = applyPriceSpread(ranked, limit);
  shuffleInPlace(picked, mulberry32(seedFrom(ctx)));

  const byId = new Map(picked.map((b) => [b.id, b]));
  for (const extra of extras) {
    if (!byId.has(extra.id)) {
      byId.set(extra.id, extra);
      picked.unshift(extra);
    }
  }
  return picked;
}

export type BrandTap = "love" | "never" | undefined;

export function cycleBrandTap(current: BrandTap): BrandTap {
  if (current === "love") return "never";
  if (current === "never") return undefined;
  return "love";
}

export function applyBrandTap(
  likes: string[],
  avoids: string[],
  brand: string,
): { likes: string[]; avoids: string[] } {
  const key = brandKey(brand);
  const isLike = likes.some((b) => brandKey(b) === key);
  const isAvoid = avoids.some((b) => brandKey(b) === key);
  const current: BrandTap = isLike ? "love" : isAvoid ? "never" : undefined;
  const next = cycleBrandTap(current);
  const drop = (list: string[]) => list.filter((b) => brandKey(b) !== key);
  if (next === "love") return { likes: [...drop(likes), brand], avoids: drop(avoids) };
  if (next === "never") return { likes: drop(likes), avoids: [...drop(avoids), brand] };
  return { likes: drop(likes), avoids: drop(avoids) };
}
