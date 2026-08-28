/**
 * Derive brand / veto / comfort chip suggestions from earlier onboarding answers.
 * Gender is a hard gate (not a score bonus) so "no heels" never lands on a man.
 */

import {
  COMFORT_OPTIONS,
  normalizeGender,
  type ComfortOption,
  type SuggestionAudience,
} from "@/lib/onboarding/form-options";

export type LovesVetoesContext = {
  genderPresentation?: string;
  styleEra?: string;
  lifestyleTags?: string[];
  valuePhilosophy?: string;
  shippingCountry?: string;
  climate?: string;
  build?: string;
  wornLabels?: string[];
  aspirationalLabels?: string[];
  wornTasteTags?: string[];
  aspirationalTasteTags?: string[];
};

type ScoredItem = {
  label: string;
  /** Signal tokens that boost this suggestion when present in context. */
  signals: string[];
  /** Soft demote when these signals dominate (e.g. luxury brand for deal hunters). */
  antiSignals?: string[];
  /** Hard gate. Omit = any presentation. */
  audience?: SuggestionAudience;
};

const BRAND_POOL: ScoredItem[] = [
  { label: "COS", signals: ["minimal", "classic", "premium", "deep_in_career", "quiet-luxury", "gallery", "30s", "40s"] },
  { label: "Uniqlo", signals: ["best_value", "deal_hunter", "minimal", "casual", "campus_life", "first_job", "athleisure", "knit"] },
  { label: "Everlane", signals: ["best_value", "minimal", "classic", "design_first", "deep_in_career"] },
  { label: "Arket", signals: ["minimal", "premium", "classic", "linen", "scandinavian"] },
  { label: "Sézane", audience: "feminine", signals: ["romantic", "parisian", "french", "premium", "blouse", "23_29", "30s"] },
  { label: "Reformation", audience: "feminine", signals: ["romantic", "design_first", "premium", "garden", "18_22", "23_29"] },
  { label: "Aritzia", audience: "feminine", signals: ["polished", "premium", "blazer", "deep_in_career", "23_29", "30s"] },
  { label: "Zara", signals: ["best_value", "deal_hunter", "trend", "campus_life", "first_job", "18_22", "23_29"] },
  { label: "& Other Stories", audience: "feminine", signals: ["design_first", "best_value", "romantic", "23_29"] },
  { label: "Massimo Dutti", signals: ["classic", "premium", "tailored", "deep_in_career", "30s", "40s"] },
  { label: "Theory", signals: ["classic", "premium", "tailored", "blazer", "deep_in_career", "running_the_show", "30s", "40s", "50s_60s"] },
  { label: "Lululemon", signals: ["athleisure", "sporty", "premium", "campus_life", "first_job", "deep_in_career"] },
  { label: "Nike", signals: ["athleisure", "sporty", "street", "campus_life", "best_value", "deal_hunter"] },
  { label: "Adidas", signals: ["athleisure", "sporty", "street", "campus_life", "best_value"] },
  { label: "New Balance", signals: ["athleisure", "minimal", "street", "best_value", "premium"] },
  { label: "Levi's", signals: ["denim", "jeans", "casual", "campus_life", "best_value", "classic"] },
  { label: "Patagonia", signals: ["linen", "outdoor", "best_value", "premium", "time_is_mine", "kids_in_the_mix"] },
  { label: "Ralph Lauren", signals: ["classic", "preppy", "premium", "luxury", "tailored", "oxford"] },
  { label: "J.Crew", signals: ["classic", "preppy", "best_value", "premium", "oxford", "chinos"] },
  { label: "Banana Republic", signals: ["classic", "deep_in_career", "best_value", "tailored", "30s", "40s"] },
  { label: "Todd Snyder", audience: "masculine", signals: ["premium", "classic", "tailored", "deep_in_career", "30s", "40s"] },
  { label: "Buck Mason", audience: "masculine", signals: ["minimal", "premium", "classic", "tee", "oxford"] },
  { label: "Asket", audience: "masculine", signals: ["minimal", "premium", "best_value", "classic"] },
  { label: "Ami", audience: "masculine", signals: ["parisian", "premium", "design_first", "23_29", "30s"] },
  { label: "APC", signals: ["minimal", "denim", "premium", "parisian", "jeans"] },
  { label: "Toteme", audience: "feminine", signals: ["minimal", "luxury", "quiet-luxury", "premium", "30s", "40s"] },
  { label: "The Row", signals: ["luxury", "minimal", "quiet-luxury", "premium", "running_the_show", "40s", "50s_60s"], antiSignals: ["deal_hunter", "best_value"] },
  { label: "Loro Piana", signals: ["luxury", "quiet-luxury", "premium", "running_the_show", "cashmere", "airport"], antiSignals: ["deal_hunter", "campus_life"] },
  { label: "Gucci", signals: ["luxury", "bold", "designer", "running_the_show"], antiSignals: ["minimal", "deal_hunter", "best_value"] },
  { label: "Prada", signals: ["luxury", "minimal", "designer", "gallery", "running_the_show"], antiSignals: ["deal_hunter"] },
  { label: "Mango", audience: "feminine", signals: ["best_value", "deal_hunter", "campus_life", "first_job"] },
  { label: "H&M", signals: ["deal_hunter", "best_value", "campus_life", "13_14", "15_17", "18_22"], antiSignals: ["luxury", "premium", "quiet-luxury"] },
  { label: "Madewell", audience: "feminine", signals: ["denim", "jeans", "best_value", "classic"] },
  { label: "Quince", signals: ["best_value", "premium", "minimal", "cashmere", "deal_hunter"] },
  { label: "Suistudio", audience: "feminine", signals: ["tailored", "blazer", "premium", "deep_in_career"] },
  { label: "Me+Em", audience: "feminine", signals: ["polished", "premium", "40s", "50s_60s", "deep_in_career"] },
  { label: "Brunello Cucinelli", signals: ["luxury", "italian", "quiet-luxury", "cashmere", "running_the_show"], antiSignals: ["deal_hunter"] },
  { label: "Stone Island", audience: "masculine", signals: ["street", "premium", "bold", "23_29"] },
];

const VETO_POOL: ScoredItem[] = [
  { label: "loud logos", signals: ["minimal", "classic", "quiet-luxury", "premium", "luxury", "gallery", "polished", "deep_in_career", "running_the_show"] },
  { label: "neon", signals: ["minimal", "classic", "quiet-luxury", "premium", "polished", "tailored", "40s", "50s_60s"] },
  { label: "distressed", signals: ["classic", "polished", "tailored", "premium", "deep_in_career", "running_the_show", "quiet-luxury"] },
  { label: "chunky sneakers", signals: ["classic", "tailored", "polished", "quiet-luxury", "formal", "blazer"] },
  { label: "fast fashion", signals: ["luxury", "premium", "quiet-luxury", "design_first", "running_the_show"] },
  { label: "overly trendy pieces", signals: ["classic", "minimal", "40s", "50s_60s", "65_plus", "time_is_mine"] },
  { label: "see-through fabrics", audience: "feminine", signals: ["classic", "deep_in_career", "polished", "tailored"] },
  { label: "super cropped cuts", audience: "feminine", signals: ["classic", "deep_in_career", "40s", "50s_60s", "polished"] },
  { label: "heavy distressing", signals: ["classic", "premium", "quiet-luxury", "polished"] },
  { label: "costume-y prints", signals: ["minimal", "classic", "quiet-luxury", "gallery"] },
  { label: "stiff formalwear", signals: ["athleisure", "linen", "relaxed", "festival", "street", "time_is_mine"] },
  { label: "office-only looks", signals: ["campus_life", "athleisure", "festival", "street", "18_22"] },
  { label: "ultra-baggy fits", signals: ["tailored", "classic", "polished", "premium"] },
  { label: "skin-tight everything", signals: ["relaxed", "linen", "minimal", "classic", "masculine"] },
  { label: "synthetic sheen", signals: ["premium", "luxury", "quiet-luxury", "linen", "design_first"] },
  { label: "logo belts", signals: ["minimal", "quiet-luxury", "classic", "premium"] },
  { label: "party sequins day-to-day", audience: "feminine", signals: ["minimal", "classic", "deep_in_career", "athleisure"] },
  { label: "tech-fabric everywhere", signals: ["classic", "romantic", "linen", "parisian", "italian"] },
  { label: "drop-crotch", audience: "masculine", signals: ["classic", "tailored", "polished", "premium"] },
  { label: "graphic-heavy tees", audience: "masculine", signals: ["classic", "minimal", "tailored", "deep_in_career"] },
];

const AVOID_BRAND_POOL: ScoredItem[] = [
  { label: "Shein", signals: ["luxury", "premium", "quiet-luxury", "design_first", "deep_in_career"] },
  { label: "Fashion Nova", audience: "feminine", signals: ["minimal", "classic", "premium", "luxury"] },
  { label: "Supreme", signals: ["minimal", "classic", "quiet-luxury", "polished", "40s", "50s_60s"] },
  { label: "Balenciaga", signals: ["minimal", "classic", "best_value", "deal_hunter", "quiet-luxury"] },
  { label: "H&M", signals: ["luxury", "premium", "quiet-luxury", "running_the_show"] },
  { label: "Forever 21", audience: "feminine", signals: ["premium", "luxury", "minimal", "deep_in_career", "40s"] },
  { label: "Guess", signals: ["minimal", "quiet-luxury", "premium", "classic"] },
  { label: "Ed Hardy", signals: ["minimal", "classic", "premium", "quiet-luxury", "polished"] },
];

function normalizeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function contextTokens(ctx: LovesVetoesContext): Set<string> {
  const tokens = new Set<string>();
  const add = (v?: string | null) => {
    if (!v?.trim()) return;
    tokens.add(normalizeToken(v));
    // Also keep spaced form pieces for label matching
    for (const part of v.toLowerCase().split(/[^a-z0-9+]+/)) {
      if (part.length > 2) tokens.add(part);
    }
  };

  add(ctx.genderPresentation);
  add(ctx.styleEra);
  add(ctx.valuePhilosophy);
  add(ctx.shippingCountry);
  add(ctx.climate);
  add(ctx.build);
  for (const t of ctx.lifestyleTags ?? []) add(t);
  for (const t of ctx.wornLabels ?? []) add(t);
  for (const t of ctx.aspirationalLabels ?? []) add(t);
  for (const t of ctx.wornTasteTags ?? []) add(t);
  for (const t of ctx.aspirationalTasteTags ?? []) add(t);

  // Soft expansions from spend / era
  const vpSet = new Set(
    (ctx.valuePhilosophy ?? "")
      .toLowerCase()
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  if (vpSet.has("luxury")) {
    tokens.add("luxury");
    tokens.add("premium");
    tokens.add("quiet-luxury");
  }
  if (vpSet.has("premium")) tokens.add("premium");
  if (vpSet.has("best_value") || vpSet.has("deal_hunter")) {
    tokens.add("best_value");
    tokens.add("deal_hunter");
  }
  if (vpSet.has("design_first")) tokens.add("design_first");

  const g = normalizeGender(ctx.genderPresentation);
  if (g === "masculine") tokens.add("masculine");
  if (g === "feminine") tokens.add("feminine");
  if (g === "androgynous" || g === "nonbinary") {
    tokens.add("minimal");
  }
  if (ctx.build === "plus" || ctx.build === "broad") {
    tokens.add("relaxed");
    tokens.add(ctx.build);
  }

  return tokens;
}

function suggestionAudience(
  ctx: LovesVetoesContext,
): SuggestionAudience | "any" {
  const g = normalizeGender(ctx.genderPresentation);
  if (g === "masculine") return "masculine";
  if (g === "feminine") return "feminine";
  return "any";
}

function itemFitsAudience(
  itemAudience: SuggestionAudience | undefined,
  user: SuggestionAudience | "any",
): boolean {
  if (!itemAudience) return true;
  if (user === "any") return true;
  return itemAudience === user;
}

function scoreItem(item: ScoredItem, tokens: Set<string>): number {
  let score = 0;
  for (const signal of item.signals) {
    const s = normalizeToken(signal);
    if (tokens.has(s) || tokens.has(signal.toLowerCase())) score += 2;
    // partial: signal word appears in any token
    for (const t of tokens) {
      if (t.includes(s) || s.includes(t)) {
        score += 1;
        break;
      }
    }
  }
  for (const anti of item.antiSignals ?? []) {
    const s = normalizeToken(anti);
    if (tokens.has(s)) score -= 3;
  }
  return score;
}

function rankPool(
  pool: ScoredItem[],
  tokens: Set<string>,
  limit: number,
  audience: SuggestionAudience | "any",
): string[] {
  const eligible = pool.filter((item) =>
    itemFitsAudience(item.audience, audience),
  );
  const ranked = eligible
    .map((item) => ({ item, score: scoreItem(item, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    const key = row.item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.item.label);
    if (out.length >= limit) break;
  }

  if (out.length < Math.min(4, limit)) {
    const fallback = eligible.filter(
      (item) => !seen.has(item.label.toLowerCase()),
    );
    for (const item of fallback) {
      out.push(item.label);
      seen.add(item.label.toLowerCase());
      if (out.length >= limit) break;
    }
  }

  return out;
}

export function suggestBrandLikes(
  ctx: LovesVetoesContext,
  limit = 8,
): string[] {
  return rankPool(
    BRAND_POOL,
    contextTokens(ctx),
    limit,
    suggestionAudience(ctx),
  );
}

export function suggestStyleVetoes(
  ctx: LovesVetoesContext,
  limit = 8,
): string[] {
  return rankPool(
    VETO_POOL,
    contextTokens(ctx),
    limit,
    suggestionAudience(ctx),
  );
}

export function suggestBrandAvoids(
  ctx: LovesVetoesContext,
  limit = 6,
): string[] {
  return rankPool(
    AVOID_BRAND_POOL,
    contextTokens(ctx),
    limit,
    suggestionAudience(ctx),
  );
}

export function suggestComfortLines(
  ctx: LovesVetoesContext,
): Array<{ value: string; label: string }> {
  const tokens = contextTokens(ctx);
  const audience = suggestionAudience(ctx);
  return COMFORT_OPTIONS.filter((o) => itemFitsAudience(o.audience, audience))
    .map((item) => ({
      item,
      score: scoreComfort(item, tokens),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || a.item.label.localeCompare(b.item.label),
    )
    .map((row) => ({ value: row.item.value, label: row.item.label }));
}

function scoreComfort(item: ComfortOption, tokens: Set<string>): number {
  return scoreItem(
    {
      label: item.label,
      signals: [...item.signals],
      antiSignals: item.antiSignals ? [...item.antiSignals] : undefined,
    },
    tokens,
  );
}
