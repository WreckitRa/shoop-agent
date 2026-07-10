/**
 * Stage 2.5 — Pool health diagnostic + corrective re-query wave.
 *
 * Cheap heuristics between retrieval and scoring. When the pool looks like junk
 * (homogeneous novelty merch, one seller dominating, everything under budget),
 * fire one corrective wave of distinct product-type queries before committing.
 */
import { candidatePriceCents } from "./pool";
import {
  craftPortfolioQuery,
  sanitizePortfolioQueries,
} from "./query-hygiene";
import { isNoveltyMerchTitle } from "./novelty-merch";
import { portfolioQueryFromText } from "./portfolio-planner-shared";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { PoolCandidate, PortfolioQuery, SearchBrief } from "./types";

function sellerDomain(product: CatalogProductSummary): string | null {
  const raw = product as unknown as Record<string, unknown>;
  const seller = raw.seller as { domain?: string; url?: string } | undefined;
  if (seller?.domain) return seller.domain.replace(/^www\./i, "");
  if (seller?.url) {
    try {
      return new URL(seller.url).hostname.replace(/^www\./i, "");
    } catch {
      /* ignore */
    }
  }
  const checkout = product.variants?.[0]?.checkout_url;
  if (checkout) {
    try {
      return new URL(checkout).hostname.replace(/^www\./i, "");
    } catch {
      /* ignore */
    }
  }
  return null;
}

const HEAD_NOUN_STOP = new Set([
  "the",
  "a",
  "an",
  "for",
  "and",
  "with",
  "men",
  "mens",
  "women",
  "womens",
  "new",
  "best",
  "set",
  "pack",
]);

export type PoolHealthReport = {
  healthy: boolean;
  typeEntropy: number;
  sellerConcentration: number;
  noveltyRatio: number;
  budgetFitRatio: number;
  reasons: string[];
};

/** Normalize a title to a coarse fingerprint for near-duplicate collapse. */
export function titleFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !HEAD_NOUN_STOP.has(w))
    .slice(0, 6)
    .sort()
    .join("|");
}

/** Extract a coarse head noun from a product title. */
export function headNounFromTitle(title: string): string | null {
  const tokens = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !HEAD_NOUN_STOP.has(t));
  if (!tokens.length) return null;
  return tokens[tokens.length - 1] ?? null;
}

function distinctHeadNouns(candidates: PoolCandidate[]): string[] {
  const nouns = new Set<string>();
  for (const c of candidates) {
    const n = headNounFromTitle(c.product.title ?? "");
    if (n) nouns.add(n);
  }
  return [...nouns];
}

function maxSellerShare(candidates: PoolCandidate[]): number {
  if (!candidates.length) return 0;
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const seller = sellerDomain(c.product) ?? "unknown";
    counts.set(seller, (counts.get(seller) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  return max / candidates.length;
}

function noveltyShare(candidates: PoolCandidate[]): number {
  if (!candidates.length) return 0;
  let hits = 0;
  for (const c of candidates) {
    if (isNoveltyMerchTitle(c.product.title ?? "")) hits += 1;
  }
  return hits / candidates.length;
}

function budgetFitShare(
  candidates: PoolCandidate[],
  budgetCents: number | null | undefined,
): number {
  if (!budgetCents || !candidates.length) return 1;
  const low = budgetCents * 0.5;
  const high = budgetCents * 1.1;
  let inBand = 0;
  let priced = 0;
  for (const c of candidates) {
    const price = candidatePriceCents(c.product);
    if (price == null) continue;
    priced += 1;
    if (price >= low && price <= high) inBand += 1;
  }
  if (!priced) return 1;
  return inBand / priced;
}

/**
 * Inspect pooled candidates before scoring. Returns `healthy: false` when the
 * pool looks homogeneous, novelty-heavy, seller-dominated, or budget-mismatched.
 */
export function assessPoolHealth(
  candidates: PoolCandidate[],
  brief: SearchBrief,
): PoolHealthReport {
  const reasons: string[] = [];
  if (candidates.length < 4) {
    return {
      healthy: true,
      typeEntropy: 1,
      sellerConcentration: 0,
      noveltyRatio: 0,
      budgetFitRatio: 1,
      reasons,
    };
  }

  const nouns = distinctHeadNouns(candidates);
  const typeEntropy = nouns.length / candidates.length;
  const sellerConcentration = maxSellerShare(candidates);
  const noveltyRatio = noveltyShare(candidates);
  const budgetFitRatio = budgetFitShare(
    candidates,
    brief.budget.amountCents ?? brief.budget.maxCents,
  );

  if (typeEntropy < 0.25) reasons.push("low_type_entropy");
  if (sellerConcentration > 0.45) reasons.push("seller_concentration");
  if (noveltyRatio > 0.35) reasons.push("novelty_heavy");
  if (
    brief.budget.amountCents != null &&
    brief.budget.type !== "none" &&
    budgetFitRatio < 0.2
  ) {
    reasons.push("budget_mismatch");
  }

  return {
    healthy: reasons.length === 0,
    typeEntropy,
    sellerConcentration,
    noveltyRatio,
    budgetFitRatio,
    reasons,
  };
}

const CORRECTIVE_PRODUCT_SEEDS: Record<string, string[]> = {
  fitness: [
    "adjustable dumbbells rubber coated",
    "wireless fitness tracker heart rate",
    "resistance bands set heavy duty",
    "foam roller muscle recovery",
  ],
  tech: [
    "wireless earbuds noise cancelling",
    "usb c hub multiport adapter",
    "portable bluetooth speaker waterproof",
    "mechanical keyboard hot swap",
  ],
  travel: [
    "packing cubes compression set",
    "passport wallet rfid blocking",
    "travel neck pillow memory foam",
    "universal travel adapter usb",
  ],
};

function seedsFromBrief(brief: SearchBrief): string[] {
  const seeds = new Set<string>();
  const lane = brief.directionLabel?.trim().toLowerCase() ?? "";
  for (const [key, templates] of Object.entries(CORRECTIVE_PRODUCT_SEEDS)) {
    if (lane.includes(key)) {
      for (const t of templates) seeds.add(t);
    }
  }
  for (const interest of brief.recipient.knownInterests ?? []) {
    const i = interest.trim();
    if (i.length >= 3) seeds.add(`${i} premium quality`);
  }
  if (brief.category?.trim()) {
    seeds.add(`${brief.category.trim()} premium`);
  }
  for (const mh of brief.mustHaves) {
    if (mh.trim().length >= 3) seeds.add(mh.trim());
  }
  if (!seeds.size && brief.query.trim()) {
    seeds.add(brief.query.trim());
  }
  return [...seeds].slice(0, 5);
}

/**
 * Build distinct anti-novelty corrective queries when the pool health gate fails.
 * Deterministic (no extra LLM) to stay inside the SLA budget.
 */
export function buildCorrectiveQueries(
  brief: SearchBrief,
  existing: PortfolioQuery[],
): PortfolioQuery[] {
  const existingTexts = new Set(existing.map((q) => q.text.toLowerCase()));
  const seeds = seedsFromBrief(brief);
  const rows: PortfolioQuery[] = [];

  for (const seed of seeds) {
    const { text, intent } = craftPortfolioQuery(seed, brief, "corrective wave");
    if (existingTexts.has(text.toLowerCase())) continue;
    const row = portfolioQueryFromText(brief, text, {
      wave: 2,
      intent,
    });
    if (row) {
      rows.push(row);
      existingTexts.add(text.toLowerCase());
    }
    if (rows.length >= 4) break;
  }

  return sanitizePortfolioQueries(rows, brief);
}

/**
 * Collapse near-duplicate titles from the same seller — keeps the best-ranked
 * representative so corroboration cannot amplify a spam cluster.
 */
export function collapseNearDuplicateCandidates(
  candidates: PoolCandidate[],
): PoolCandidate[] {
  const kept = new Map<string, PoolCandidate>();
  const out: PoolCandidate[] = [];

  for (const c of candidates) {
    const seller = sellerDomain(c.product) ?? "unknown";
    const fp = `${seller}::${titleFingerprint(c.product.title ?? "")}`;
    const existing = kept.get(fp);
    if (!existing) {
      kept.set(fp, c);
      out.push(c);
      continue;
    }
    if (c.bestRank < existing.bestRank) {
      kept.set(fp, c);
      const idx = out.indexOf(existing);
      if (idx >= 0) out[idx] = c;
    }
  }

  return out;
}

/** Cap corroboration when the title is novelty merch (cross-query junk clusters). */
export function effectiveCorroboration(c: PoolCandidate): number {
  const raw = c.corroboration;
  if (isNoveltyMerchTitle(c.product.title ?? "")) return 1;
  return Math.min(raw, 4);
}
