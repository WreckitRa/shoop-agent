import {
  DEPARTMENT_QUERY_WORDS,
  ensureDepartmentQueryPrefix,
  isGenderedDepartment,
  resolveSearchDepartment,
  type FashionDepartment,
} from "../department";
import {
  BANNED_QUERY_PATTERNS,
  COLOR_WORDS,
  MAX_QUERY_VARIANTS,
  MAX_VARIANT_TOKEN_OVERLAP,
  MIN_QUERY_VARIANTS,
} from "./query-rules";
import type { PaletteSource } from "./palette-ladder";

const CLEAN_TOKEN_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Raw tokens without stripping punctuation — used for garble detection. */
export function rawQueryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenOverlapRatio(a: string, b: string): number {
  const ta = new Set(tokenizeQuery(a));
  const tb = new Set(tokenizeQuery(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  return shared / union;
}

export function containsBannedToken(query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return BANNED_QUERY_PATTERNS.some((re) => re.test(q));
}

export function stripBannedTokens(query: string): string {
  let q = query.trim();
  for (const re of BANNED_QUERY_PATTERNS) {
    q = q.replace(re, " ");
  }
  return q.replace(/\s+/g, " ").trim();
}

export function colorWordsInQuery(query: string): string[] {
  return tokenizeQuery(query).filter((t) => COLOR_WORDS.has(t));
}

function stripColorWords(query: string): string {
  const tokens = tokenizeQuery(query).filter((t) => !COLOR_WORDS.has(t));
  return tokens.join(" ").trim();
}

export type VariantShapeCheck = {
  ok: boolean;
  reason?: string;
};

/**
 * Cheap spell-guard: department word + primary garment noun (with aliases)
 * as intact dictionary-clean tokens. Catches LLM typos like ",em cotto dress hirt".
 * Synonyms allowed: "dress pants" ↔ trousers/pants/chinos.
 */
const GARMENT_ALIAS_GROUPS: string[][] = [
  ["pant", "pants", "trouser", "trousers", "chino", "chinos", "slacks"],
  ["shoe", "shoes", "oxford", "derby", "loafer", "loafers", "boot", "boots"],
  ["shirt", "shirts", "blouse", "oxford"],
  ["sneaker", "sneakers", "trainer", "trainers"],
  ["jean", "jeans", "denim"],
  ["tie", "necktie", "cravat"],
  ["blazer", "jacket", "sportcoat", "sport coat"],
];

function garmentNounSatisfied(
  garmentTokens: string[],
  queryTokens: Set<string>,
): boolean {
  // Prefer the most specific noun (last token): "dress pants" → pants.
  const primary = garmentTokens[garmentTokens.length - 1]!;
  if (queryTokens.has(primary)) return true;

  for (const group of GARMENT_ALIAS_GROUPS) {
    if (!group.includes(primary)) continue;
    if (group.some((alias) => queryTokens.has(alias))) return true;
  }

  // Multi-word exact: all tokens present (e.g. "dress" + "shirt").
  if (
    garmentTokens.length > 1 &&
    garmentTokens.every((t) => queryTokens.has(t))
  ) {
    return true;
  }

  return false;
}

export function assertVariantShape(params: {
  query: string;
  garment: string;
  department?: FashionDepartment | string | null;
}): VariantShapeCheck {
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.department,
  });
  const cleanTokens = new Set(tokenizeQuery(params.query));
  const rawTokens = rawQueryTokens(params.query);

  for (const raw of rawTokens) {
    if (!CLEAN_TOKEN_RE.test(raw)) {
      return { ok: false, reason: `garbled_token:${raw}` };
    }
  }

  if (isGenderedDepartment(department)) {
    const word = DEPARTMENT_QUERY_WORDS[department];
    if (!cleanTokens.has(word)) {
      return { ok: false, reason: `missing_department:${word}` };
    }
  }

  const garmentTokens = tokenizeQuery(params.garment);
  if (
    garmentTokens.length > 0 &&
    !garmentNounSatisfied(garmentTokens, cleanTokens)
  ) {
    return {
      ok: false,
      reason: `missing_garment_token:${garmentTokens.join("_")}`,
    };
  }

  return { ok: true };
}

export type SlotVariantValidation = {
  ok: boolean;
  variants: string[];
  reasons: string[];
  shapeRejected?: string[];
};

/**
 * Code-side validator for planner query_variants per slot.
 * Enforces banned tokens (recipient/size/budget — NOT department words),
 * >60% overlap rejection, color-in-one-variant, mandatory department
 * first-token for gendered departments (prepend fix, never reject),
 * and garment/department shape assertion.
 */
export function validateSlotQueryVariants(params: {
  variants: string[];
  garment?: string;
  paletteSource?: PaletteSource;
  allowedColorWords?: string[];
  department?: FashionDepartment | string | null;
}): SlotVariantValidation {
  const reasons: string[] = [];
  const shapeRejected: string[] = [];
  const paletteSource = params.paletteSource ?? "spread";
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.department,
  });

  if (paletteSource === "spread") {
    const strippedVariants = params.variants.map((raw) => {
      const stripped = stripBannedTokens(raw);
      const withoutColor = stripColorWords(stripped);
      if (withoutColor !== stripped) {
        reasons.push(`stripped_spread_color: ${raw}`);
      }
      return withoutColor;
    });
    return applyShapeAndDepartment(
      validateCleanedVariants(strippedVariants, new Set(), reasons),
      department,
      params.garment,
      reasons,
      shapeRejected,
    );
  }

  const allowedColors = new Set(
    (params.allowedColorWords ?? []).map((c) => c.toLowerCase()),
  );

  const cleaned: string[] = [];
  for (const raw of params.variants) {
    const stripped = stripBannedTokens(raw);
    if (!stripped || containsBannedToken(stripped)) {
      reasons.push(`rejected_banned: ${raw}`);
      continue;
    }
    if (stripped.split(/\s+/).length < 2) {
      reasons.push(`rejected_too_short: ${raw}`);
      continue;
    }
    cleaned.push(stripped);
  }

  return applyShapeAndDepartment(
    validateCleanedVariants(cleaned, allowedColors, reasons, paletteSource),
    department,
    params.garment,
    reasons,
    shapeRejected,
  );
}

function applyShapeAndDepartment(
  result: SlotVariantValidation,
  department: FashionDepartment,
  garment: string | undefined,
  reasons: string[],
  shapeRejected: string[],
): SlotVariantValidation {
  const prefixed = result.variants.map((q) => {
    const fixed = ensureDepartmentQueryPrefix(q, department);
    if (fixed !== q) reasons.push(`prepended_department: ${q} → ${fixed}`);
    return fixed;
  });

  if (!garment?.trim()) {
    return { ...result, variants: prefixed, reasons, shapeRejected };
  }

  const kept: string[] = [];
  for (const q of prefixed) {
    const shape = assertVariantShape({ query: q, garment, department });
    if (!shape.ok) {
      reasons.push(`variant_shape_rejected: ${q} (${shape.reason})`);
      shapeRejected.push(q);
      continue;
    }
    kept.push(q);
  }

  const ok = kept.length >= MIN_QUERY_VARIANTS;
  if (!ok && kept.length === 1) reasons.push("needs_second_variant");
  if (kept.length === 0) reasons.push("no_valid_variants");

  return {
    ok,
    variants: kept.slice(0, MAX_QUERY_VARIANTS),
    reasons,
    shapeRejected,
  };
}

function validateCleanedVariants(
  cleaned: string[],
  allowedColors: Set<string>,
  reasons: string[],
  paletteSource: PaletteSource = "spread",
): SlotVariantValidation {
  const deduped: string[] = [];
  for (const q of cleaned) {
    if (deduped.some((existing) => existing.toLowerCase() === q.toLowerCase())) {
      reasons.push(`rejected_duplicate: ${q}`);
      continue;
    }
    let dominated = false;
    for (const existing of deduped) {
      if (tokenOverlapRatio(q, existing) > MAX_VARIANT_TOKEN_OVERLAP) {
        reasons.push(`rejected_overlap: ${q}`);
        dominated = true;
        break;
      }
    }
    if (!dominated) deduped.push(q);
  }

  const withColorPolicy: string[] = [];
  let colorVariantCount = 0;

  for (const q of deduped) {
    const colors = colorWordsInQuery(q);
    if (colors.length === 0) {
      withColorPolicy.push(q);
      continue;
    }

    const disallowed = colors.filter((c) => !allowedColors.has(c));
    if (disallowed.length && paletteSource === "stated") {
      const withoutColor = stripColorWords(q);
      if (withoutColor.split(/\s+/).length >= 2 && !containsBannedToken(withoutColor)) {
        withColorPolicy.push(withoutColor);
        reasons.push(`stripped_disallowed_color: ${q}`);
      } else {
        reasons.push(`rejected_color_not_allowed: ${q}`);
      }
      continue;
    }

    if (
      disallowed.length &&
      (paletteSource === "profile" || paletteSource === "occasion_default")
    ) {
      const withoutColor = stripColorWords(q);
      if (withoutColor.split(/\s+/).length >= 2 && !containsBannedToken(withoutColor)) {
        withColorPolicy.push(withoutColor);
        reasons.push(`stripped_non_palette_color: ${q}`);
      } else {
        reasons.push(`rejected_color_not_allowed: ${q}`);
      }
      continue;
    }

    colorVariantCount += 1;
    if (colorVariantCount > 1) {
      const withoutColor = stripColorWords(q);
      if (withoutColor.split(/\s+/).length >= 2) {
        withColorPolicy.push(withoutColor);
        reasons.push(`stripped_extra_color_variant: ${q}`);
      } else {
        reasons.push(`rejected_multiple_color_variants: ${q}`);
      }
      continue;
    }
    withColorPolicy.push(q);
  }

  const finalDeduped: string[] = [];
  for (const q of withColorPolicy) {
    let dominated = false;
    for (const existing of finalDeduped) {
      if (tokenOverlapRatio(q, existing) > MAX_VARIANT_TOKEN_OVERLAP) {
        dominated = true;
        break;
      }
    }
    if (!dominated) finalDeduped.push(q);
  }

  const ok = finalDeduped.length >= MIN_QUERY_VARIANTS;
  if (!ok && finalDeduped.length === 1) {
    reasons.push("needs_second_variant");
  }
  if (finalDeduped.length === 0) {
    reasons.push("no_valid_variants");
  }

  return {
    ok,
    variants: finalDeduped.slice(0, MAX_QUERY_VARIANTS),
    reasons,
  };
}

export { COLOR_WORDS, MAX_VARIANT_TOKEN_OVERLAP };
