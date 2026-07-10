import {
  productFactTokens,
  type CatalogInferredAttribute,
} from "@/lib/shopify/catalog-attributes";
import { logAiChat } from "../observability";

/** Reasons that indicate catalog-rank padding — log as rule violations. */
const GENERIC_REASON_PATTERNS = [
  /\btop[- ]ranked\b/i,
  /\btop match for your query\b/i,
  /\bbest overall match\b/i,
  /\bbest starting point while deeper curation\b/i,
  /\blines up with the product type\b/i,
  /\bmatches your search\b/i,
  /\bfrom this catalog search\b/i,
  /\bstrongest quality for the price among the results\b/i,
  /\bmost reviewed and proven among the results\b/i,
  /\bpersonalizing picks\b/i,
];

const FEATURE_SIGNAL_WORDS = new Set([
  "matte",
  "gloss",
  "glossy",
  "leather",
  "suede",
  "canvas",
  "nylon",
  "wool",
  "cotton",
  "silk",
  "linen",
  "denim",
  "rubber",
  "lug",
  "lugged",
  "chunky",
  "sleek",
  "minimal",
  "formal",
  "casual",
  "street",
  "streetwear",
  "boot",
  "sneaker",
  "loafer",
  "slip-on",
  "zip",
  "lace",
  "black",
  "white",
  "brown",
  "navy",
  "embossed",
  "croc",
  "crocodile",
  "patent",
  "waterproof",
  "insulated",
  "breathable",
  "merino",
  "fleece",
  "oversized",
  "slim",
  "relaxed",
  "heel",
  "sole",
  "toe",
  "cap-toe",
  "ankle",
  "knee",
  "high-top",
  "low-top",
]);

export type ReasonValidationContext = {
  title: string;
  attributes?: CatalogInferredAttribute[];
  options?: Array<{ name: string; values: Array<{ label: string }> }>;
  tier?: number;
  slot?: string;
  productId?: string;
};

export type ReasonValidationResult = {
  ok: boolean;
  violation?: string;
};

function reasonMatchesGenericPattern(reason: string): string | null {
  for (const re of GENERIC_REASON_PATTERNS) {
    if (re.test(reason)) return re.source;
  }
  return null;
}

function reasonOverlapsProductFacts(
  reason: string,
  ctx: ReasonValidationContext,
): boolean {
  const reasonWords = reason
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3);
  const factTokens = new Set(productFactTokens(ctx));

  for (const w of reasonWords) {
    if (factTokens.has(w)) return true;
    if (FEATURE_SIGNAL_WORDS.has(w)) return true;
  }

  // Multi-word attribute values (e.g. "crocodile embossed")
  for (const a of ctx.attributes ?? []) {
    const phrase = a.value.toLowerCase();
    if (phrase.length >= 4 && reason.toLowerCase().includes(phrase)) return true;
  }

  return false;
}

/** Canary: tier-1 / hero reasons must cite real product features. */
export function validatePickReason(
  reason: string,
  ctx: ReasonValidationContext,
): ReasonValidationResult {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { ok: false, violation: "empty_reason" };
  }

  const generic = reasonMatchesGenericPattern(trimmed);
  if (generic) {
    return { ok: false, violation: "generic_rank_reason" };
  }

  const requiresFeatures = ctx.tier === 1 || ctx.slot === "shoop_pick";
  if (requiresFeatures && !reasonOverlapsProductFacts(trimmed, ctx)) {
    return { ok: false, violation: "tier1_no_product_features" };
  }

  return { ok: true };
}

export function logReasonViolation(
  reason: string,
  ctx: ReasonValidationContext,
  result: ReasonValidationResult,
): void {
  if (result.ok || !result.violation) return;
  logAiChat("warn", "pick_reason_rule_violation", {
    violation: result.violation,
    tier: ctx.tier,
    slot: ctx.slot,
    productId: ctx.productId,
    title: ctx.title.slice(0, 120),
    reason: reason.slice(0, 220),
    attributeCount: ctx.attributes?.length ?? 0,
  });
}

/** Downgrade verdict when tier-1 claim cannot be justified. */
export function verdictForTierPlacement(params: {
  tier: number;
  confidence: "strong" | "moderate" | "limited";
  reasonValid: boolean;
  hasTier1InSet: boolean;
  overBudget: boolean;
}): "buy" | "wait" | "dont_recommend" {
  if (params.overBudget) return "wait";
  if (params.tier === 1 && params.reasonValid && params.confidence !== "limited") {
    return "buy";
  }
  if (params.tier === 1 && !params.reasonValid) return "wait";
  if (params.tier === 1 && params.confidence === "limited") return "wait";
  if (params.tier === 2) return "wait";
  if (params.tier === 3) return "wait";
  return "wait";
}

export function thinSetCaveat(hasTier1: boolean, candidateCount: number): string | undefined {
  if (hasTier1 || candidateCount >= 8) return undefined;
  return "Best of a limited set — want me to widen the search?";
}
