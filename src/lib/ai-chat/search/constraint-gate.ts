/**
 * Deterministic constraint gate between retrieval/scoring and judgment.
 *
 * Catalog filters only cover price/ships_to — color, gender, and explicit
 * must-have attributes are enforced here so violators never reach the judge
 * or narrator.
 */
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { PoolCandidate, ScoredCandidate, SearchBrief } from "./types";
import type { VerifiedCandidate } from "./verify";

export type ConstraintGateKind =
  | "color"
  | "gender"
  | "must_have"
  | "judge_omission"
  | "listing_hygiene";

export type ConstraintGateDrop = {
  productId: string;
  title: string;
  reason: string;
  gate: ConstraintGateKind;
};

export type ConstraintGateMetrics = {
  inputCount: number;
  outputCount: number;
  drops: ConstraintGateDrop[];
  dropsByGate: Partial<Record<ConstraintGateKind, number>>;
};

const COLOR_TOKENS = [
  "black",
  "white",
  "beige",
  "navy",
  "olive",
  "grey",
  "gray",
  "brown",
  "red",
  "blue",
  "green",
  "pink",
  "cream",
  "ivory",
  "charcoal",
  "tan",
  "burgundy",
] as const;

const COLOR_SYNONYMS: Record<string, string[]> = {
  black: ["black", "onyx", "noir", "ebony"],
  white: ["white", "ivory", "cream", "off-white", "off white"],
  beige: ["beige", "tan", "sand", "khaki", "ecru"],
  navy: ["navy", "navy blue", "midnight blue"],
  olive: ["olive", "army green", "military green"],
};

const WOMENS_SIGNALS =
  /\b(women'?s?|womens|ladies|female|for her|woman's)\b/i;
const MENS_SIGNALS = /\b(men'?s?|mens|male|for him|man's)\b/i;

function productText(product: CatalogProductSummary): string {
  const parts: string[] = [product.title ?? ""];
  for (const a of extractCatalogAttributes(product)) {
    parts.push(a.name, a.value);
  }
  for (const opt of product.options ?? []) {
    parts.push(opt.name);
    for (const v of opt.values ?? []) parts.push(v.label);
  }
  return parts.join(" ").toLowerCase();
}

function colorMentioned(text: string, color: string): boolean {
  const synonyms = COLOR_SYNONYMS[color] ?? [color];
  return synonyms.some((s) => text.includes(s));
}

/** Colors the brief requires (variant constraint + explicit must-have color tokens). */
export function requiredColors(brief: SearchBrief): string[] {
  const out = new Set<string>();
  const vc = brief.variantConstraints?.color?.trim().toLowerCase();
  if (vc) out.add(vc);
  for (const mh of brief.mustHaves) {
    const t = mh.trim().toLowerCase();
    for (const c of COLOR_TOKENS) {
      if (t === c || t.includes(c)) out.add(c);
    }
  }
  return [...out];
}

function conflictingColorPresent(text: string, required: string): boolean {
  for (const c of COLOR_TOKENS) {
    if (c === required) continue;
    if (colorMentioned(text, c)) return true;
  }
  return false;
}

export function colorConstraintViolation(
  brief: SearchBrief,
  text: string,
): string | null {
  const required = requiredColors(brief);
  if (!required.length) return null;

  for (const req of required) {
    if (colorMentioned(text, req)) continue;
    if (conflictingColorPresent(text, req)) {
      return `requires ${req} but product signals another color`;
    }
  }
  return null;
}

export function genderConstraintViolation(
  brief: SearchBrief,
  text: string,
): string | null {
  if (brief.recipient.kind === "other") return null;
  if (brief.genderScope === "mens") {
    if (WOMENS_SIGNALS.test(text) && !MENS_SIGNALS.test(text)) {
      return "scoped to men's but product signals women's";
    }
  }
  if (brief.genderScope === "womens") {
    if (MENS_SIGNALS.test(text) && !WOMENS_SIGNALS.test(text)) {
      return "scoped to women's but product signals men's";
    }
  }
  return null;
}

/** Must-have color tokens that fail when another color is present in the product. */
export function mustHaveColorViolation(
  brief: SearchBrief,
  text: string,
): string | null {
  for (const mh of brief.mustHaves) {
    const t = mh.trim().toLowerCase();
    for (const c of COLOR_TOKENS) {
      if (t !== c && !t.includes(c)) continue;
      if (!colorMentioned(text, c) && conflictingColorPresent(text, c)) {
        return `must-have "${mh}" not satisfied`;
      }
    }
  }
  return null;
}

export function violatesStructuredConstraints(
  brief: SearchBrief,
  product: CatalogProductSummary,
): ConstraintGateDrop | null {
  const text = productText(product);
  const gender = genderConstraintViolation(brief, text);
  if (gender) {
    return {
      productId: product.id,
      title: product.title ?? "",
      reason: gender,
      gate: "gender",
    };
  }
  const color = colorConstraintViolation(brief, text);
  if (color) {
    return {
      productId: product.id,
      title: product.title ?? "",
      reason: color,
      gate: "color",
    };
  }
  const mustHave = mustHaveColorViolation(brief, text);
  if (mustHave) {
    return {
      productId: product.id,
      title: product.title ?? "",
      reason: mustHave,
      gate: "must_have",
    };
  }
  return null;
}

export function applyConstraintGate<T extends { product: CatalogProductSummary }>(
  candidates: T[],
  brief: SearchBrief,
): { passed: T[]; metrics: ConstraintGateMetrics } {
  const drops: ConstraintGateDrop[] = [];
  const passed: T[] = [];
  for (const c of candidates) {
    const violation = violatesStructuredConstraints(brief, c.product);
    if (violation) drops.push(violation);
    else passed.push(c);
  }
  const dropsByGate: Partial<Record<ConstraintGateKind, number>> = {};
  for (const d of drops) {
    dropsByGate[d.gate] = (dropsByGate[d.gate] ?? 0) + 1;
  }
  return {
    passed,
    metrics: {
      inputCount: candidates.length,
      outputCount: passed.length,
      drops,
      dropsByGate,
    },
  };
}

export function filterVerifiedByConstraints(
  verified: VerifiedCandidate[],
  brief: SearchBrief,
): { passed: VerifiedCandidate[]; metrics: ConstraintGateMetrics } {
  return applyConstraintGate(verified, brief);
}

export function filterPoolByConstraints(
  pool: PoolCandidate[],
  brief: SearchBrief,
): { passed: PoolCandidate[]; metrics: ConstraintGateMetrics } {
  return applyConstraintGate(pool, brief);
}

export function filterScoredByConstraints(
  scored: ScoredCandidate[],
  brief: SearchBrief,
): { passed: ScoredCandidate[]; metrics: ConstraintGateMetrics } {
  return applyConstraintGate(scored, brief);
}
