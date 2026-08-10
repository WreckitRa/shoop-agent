/**
 * Swimwear subtype helpers — one-/two-piece exclusivity and brief refinement.
 * Soft "swimsuit" / "something for the beach" stays parent-family (no subtype).
 */
import { preNormalize } from "../normalize/pre-normalize";

export type SwimSubtype = "one_piece" | "two_piece";

const GENERIC_SWIM_RE =
  /\b(swimwear|swimsuit|swimsuits|swim|bathing\s+suit|bathing\s+suits)\b/i;

const TWO_PIECE_MARKERS = [
  "two piece",
  "2 piece",
  "bikini",
  "bikinis",
  "tankini",
  "tankinis",
  "skirtini",
  "skirtinis",
] as const;

const ONE_PIECE_MARKERS = [
  "one piece",
  "1 piece",
  "monokini",
  "maillot",
  "swim dress",
] as const;

function normPhraseHit(norm: string, phrase: string): boolean {
  return ` ${norm} `.includes(` ${phrase} `);
}

/** True when the garment string is swim-family (generic or subtype). */
export function isSwimGarment(garment: string): boolean {
  const g = preNormalize(garment);
  if (!g) return false;
  if (GENERIC_SWIM_RE.test(g)) return true;
  if (TWO_PIECE_MARKERS.some((m) => normPhraseHit(g, m) || g === m)) return true;
  if (ONE_PIECE_MARKERS.some((m) => normPhraseHit(g, m) || g === m)) return true;
  if (/\b(board\s*shorts?|rash\s*guards?|cover[\s-]?ups?|burkini)\b/i.test(g)) {
    return true;
  }
  return false;
}

/**
 * Resolve one-/two-piece subtype from a slot garment or product title.
 * Returns null when the text is generic swim or non-swim — unknown never drops.
 */
export function resolveSwimSubtype(text: string): SwimSubtype | null {
  const norm = preNormalize(text);
  if (!norm) return null;

  const two = TWO_PIECE_MARKERS.some((m) => normPhraseHit(norm, m) || norm === m);
  const one = ONE_PIECE_MARKERS.some((m) => normPhraseHit(norm, m) || norm === m);

  // Explicit conflict → prefer the more specific construction markers.
  if (two && !one) return "two_piece";
  if (one && !two) return "one_piece";
  if (two && one) {
    // "one piece bikini" is rare; prefer two-piece when bikini is present.
    if (/\bbikini/.test(norm)) return "two_piece";
    return "one_piece";
  }
  return null;
}

/**
 * When must_haves / garment text names one-/two-piece and the slot is still
 * generic "swimsuit", upgrade to a structured swim garment for taxonomy + drops.
 */
export function refineSwimGarmentLabel(params: {
  garment: string;
  mustHaves?: string[];
  niceToHaves?: string[];
}): string {
  const garment = params.garment.trim();
  if (!garment) return garment;

  const existing = resolveSwimSubtype(garment);
  if (existing === "two_piece") {
    return /swimsuit|swimwear|bikini/i.test(garment)
      ? garment
      : "two-piece swimsuit";
  }
  if (existing === "one_piece") {
    return /swimsuit|swimwear/i.test(garment)
      ? garment
      : "one-piece swimsuit";
  }

  if (!GENERIC_SWIM_RE.test(garment) && !isSwimGarment(garment)) {
    return garment;
  }

  const extras = [
    ...(params.mustHaves ?? []),
    ...(params.niceToHaves ?? []),
  ].join(" ");
  const fromExtras = resolveSwimSubtype(extras);
  if (fromExtras === "two_piece") return "two-piece swimsuit";
  if (fromExtras === "one_piece") return "one-piece swimsuit";
  return garment;
}

/** Upgrade brief.garments when swim subtype lives in must_haves only. */
export function refineSwimBriefGarments(params: {
  garments: string[];
  mustHaves?: string[];
  niceToHaves?: string[];
}): string[] {
  return params.garments.map((g) =>
    refineSwimGarmentLabel({
      garment: g,
      mustHaves: params.mustHaves,
      niceToHaves: params.niceToHaves,
    }),
  );
}

/**
 * Display label from survivors when the plan garment is generic swim and
 * survivors confidently share a subtype. Never invent a subtype from empty pools.
 */
export function displayGarmentFromSurvivors(params: {
  planGarment: string;
  survivorTitles: string[];
}): string {
  const plan = params.planGarment.trim() || params.planGarment;
  if (!params.survivorTitles.length) return plan;
  if (resolveSwimSubtype(plan)) return plan;
  if (!isSwimGarment(plan) && !GENERIC_SWIM_RE.test(plan)) return plan;

  const subtypes = params.survivorTitles
    .map((t) => resolveSwimSubtype(t))
    .filter((s): s is SwimSubtype => s != null);
  if (subtypes.length < Math.max(1, Math.ceil(params.survivorTitles.length * 0.5))) {
    return plan;
  }
  const first = subtypes[0]!;
  if (!subtypes.every((s) => s === first)) return plan;
  return first === "two_piece" ? "two-piece swimsuit" : "one-piece swimsuit";
}
