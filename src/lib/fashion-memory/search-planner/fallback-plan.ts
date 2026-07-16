import type { FashionSearchBrief } from "../router/types";
import {
  allowedColorWordsFromBrief,
  buildDeterministicQueryVariants,
} from "./deterministic-builder";
import type {
  FashionSearchPlan,
  FashionSearchPlanSlot,
  SearchPlanMode,
  SearchPlanSlotRole,
} from "./types";

const MAX_SLOTS = 12;

const TOP_GARMENT_RE =
  /\b(shirt|blazer|jacket|coat|dress|top|blouse|sweater|hoodie|suit)\b/i;

/** Lower = more occasion-central (shirt/trousers/shoes before tie). */
export function garmentOccasionRank(garment: string): number {
  const t = garment.toLowerCase();
  if (/\b(shirt|blouse|top|blazer|jacket|coat|sweater|hoodie|suit)\b/.test(t)) {
    return 0;
  }
  if (/\b(trouser|pant|chino|jean|skirt|short)\b/.test(t)) return 1;
  if (/\b(shoe|boot|loafer|oxford|sneaker|heel|sandal)\b/.test(t)) return 2;
  if (/\b(tie|belt|sock|watch|cufflink|pocket\s*square|scarf)\b/.test(t)) {
    return 4;
  }
  return 3;
}

/** Prefer brief garments; when over max, keep the most occasion-central. */
export function selectGarmentsForPlan(
  garments: string[],
  max = MAX_SLOTS,
): string[] {
  const cleaned = garments.map((g) => g.trim()).filter(Boolean);
  if (cleaned.length <= max) return cleaned;
  return [...cleaned]
    .sort((a, b) => {
      const rank = garmentOccasionRank(a) - garmentOccasionRank(b);
      if (rank !== 0) return rank;
      return cleaned.indexOf(a) - cleaned.indexOf(b);
    })
    .slice(0, max);
}

/**
 * Occasion-standard head-to-toe when the brief under-specifies garments.
 * Business/formal → shirt + trousers + shoes.
 */
export function occasionStandardGarments(brief: FashionSearchBrief): string[] {
  const fromBrief = selectGarmentsForPlan(brief.garments);
  if (fromBrief.length >= 2) return fromBrief;

  const occasion = `${brief.occasion_context} ${brief.style_direction} ${brief.quantity_hint}`.toLowerCase();
  if (/\b(business|office|work|formal|interview|professional)\b/.test(occasion)) {
    return ["dress shirt", "dress pants", "dress shoes"];
  }
  if (/\b(wedding|black\s*tie|cocktail|party)\b/.test(occasion)) {
    return ["dress shirt", "dress pants", "dress shoes"];
  }
  return ["shirt", "trousers", "shoes"];
}

function parseExplicitOptionsWanted(brief: FashionSearchBrief): number | null {
  const qty = `${brief.quantity_hint ?? ""}`.toLowerCase();
  const wordMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
  };
  for (const [word, n] of Object.entries(wordMap)) {
    if (new RegExp(`\\b${word}\\b`).test(qty)) return n;
  }
  const digit = qty.match(/\b(\d+)\b/);
  if (digit) {
    const n = Number(digit[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 8) return n;
  }
  for (const mh of brief.must_haves) {
    const m = mh.toLowerCase().match(/\b(\d+)\s+(shirt|shirts|pant|pants|shoe|shoes|dress|dresses)\b/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 8) return n;
    }
  }
  return null;
}

function optionsWantedForFallback(brief: FashionSearchBrief): number {
  return parseExplicitOptionsWanted(brief) ?? 4;
}

function pickAnchorIndex(garments: string[]): number {
  const idx = garments.findIndex((g) => TOP_GARMENT_RE.test(g));
  return idx === -1 ? 0 : idx;
}

function equalFraction(n: number): number {
  if (n <= 0) return 1;
  return Math.round((1 / n) * 1000) / 1000;
}

export function buildSlotsFromGarments(params: {
  garments: string[];
  brief: FashionSearchBrief;
  mode: SearchPlanMode;
}): FashionSearchPlanSlot[] {
  const garments = params.garments.length
    ? params.garments
    : [params.brief.garments[0] ?? "item"];
  const anchorIdx = pickAnchorIndex(garments);
  const optionsWanted = optionsWantedForFallback(params.brief);
  const budgetStated = Boolean(params.brief.budget_context?.stated);
  const fraction = equalFraction(garments.length);
  const department =
    params.brief.knowledge_state?.department ?? params.brief.department_scope;
  const includeColor = allowedColorWordsFromBrief(params.brief).length > 0;

  return garments.map((garment, i) => {
    const role: SearchPlanSlotRole = i === anchorIdx ? "anchor" : "support";
    const variants = buildDeterministicQueryVariants({
      garment,
      styleDirection: params.brief.style_direction,
      mustHaves: params.brief.must_haves,
      includeColor,
      department,
    });
    return {
      slot_id: garment.toLowerCase().replace(/\s+/g, "_"),
      garment,
      role,
      style_direction: params.brief.style_direction,
      palette_constraint: "broad neutral palette",
      palette_source: "spread" as const,
      options_wanted: optionsWanted,
      query_variants: variants,
      ...(budgetStated &&
      (params.mode === "outfit" || params.mode === "capsule")
        ? { budget_fraction: fraction }
        : {}),
    };
  });
}

/** Full multi-slot fallback from brief garments (max 5, occasion-ranked). */
export function buildFallbackPlan(params: {
  brief: FashionSearchBrief;
  currentDate: string;
  reasoning?: string;
}): FashionSearchPlan {
  const mode = params.brief.request_type;
  const garments =
    mode === "outfit" || mode === "capsule"
      ? occasionStandardGarments(params.brief)
      : selectGarmentsForPlan(
          params.brief.garments.length
            ? params.brief.garments
            : [params.brief.garments[0] ?? "item"],
          mode === "single_item" ? 1 : MAX_SLOTS,
        );

  return {
    version: 1,
    mode,
    reasoning:
      params.reasoning ??
      "Deterministic fallback plan after planner failure.",
    brief: params.brief,
    currentDate: params.currentDate,
    plan_source: "fallback",
    slots: buildSlotsFromGarments({
      garments,
      brief: params.brief,
      mode,
    }),
  };
}

/** Force outfit/capsule to ≥2 slots via occasion-standard garments. */
export function expandOutfitSlots(params: {
  plan: FashionSearchPlan;
}): FashionSearchPlan {
  const garments = occasionStandardGarments(params.plan.brief);
  return {
    ...params.plan,
    plan_source: "fallback",
    reasoning: `${params.plan.reasoning} Expanded to occasion-standard slots after under-slot outfit/capsule plan.`,
    slots: buildSlotsFromGarments({
      garments,
      brief: params.plan.brief,
      mode: params.plan.mode,
    }),
  };
}
