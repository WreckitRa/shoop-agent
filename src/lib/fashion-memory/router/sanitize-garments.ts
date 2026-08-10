/**
 * Router garment sanitizer (v1.1): style phrases must never become slots.
 * Merge style fluff into style_direction; keep real garments.
 */
import { isKnownGarmentFamily } from "./garment-family";
import type { FashionSearchBrief } from "./types";

/** Tokens that are clearly style/occasion descriptors, not SKUs. */
const STYLE_PHRASE_RE =
  /\b(laid[-\s]?back|cool\s+style|effortless|vibe|aesthetic|look|mood|energy|casual\s+cool|day\s+party|style\s+laid)\b/i;

/**
 * A garment string is a style phrase if it is not a known family AND matches
 * style vocabulary (or multi-word fluff without a clothing noun).
 */
export function isStylePhraseGarment(garment: string): boolean {
  const g = garment.trim();
  if (!g) return false;
  if (isKnownGarmentFamily(g)) return false;
  if (STYLE_PHRASE_RE.test(g)) return true;
  const words = g.split(/\s+/).filter(Boolean);
  if (
    words.length >= 3 &&
    !/\b(shirt|pant|trouser|shoe|dress|jacket|coat|top|bottom|bottoms|sneaker|jean|skirt|blazer|sweater|hoodie|boot|loafer|belt|tie|watch|bag|swimsuit|swimwear|bikini)\b/i.test(
      g,
    )
  ) {
    return true;
  }
  return false;
}

export function sanitizeBriefGarments(
  brief: FashionSearchBrief,
): FashionSearchBrief {
  const kept: string[] = [];
  const mergedStyle: string[] = [];

  for (const raw of brief.garments ?? []) {
    const g = raw.trim();
    if (!g) continue;
    if (isStylePhraseGarment(g)) {
      mergedStyle.push(g);
      continue;
    }
    kept.push(g);
  }

  const uniqueKept = [...new Set(kept.map((g) => g.toLowerCase()))].map(
    (lower) => kept.find((g) => g.toLowerCase() === lower)!,
  );
  const uniqueStyle = [...new Set(mergedStyle)];

  if (
    !uniqueStyle.length &&
    uniqueKept.length === (brief.garments?.length ?? 0)
  ) {
    return brief;
  }

  const styleExtra = uniqueStyle.join(", ");
  const style_direction = [brief.style_direction?.trim(), styleExtra]
    .filter(Boolean)
    .join(" — ");

  const must_haves = (brief.must_haves ?? []).filter(
    (m) => !uniqueStyle.some((s) => s.toLowerCase() === m.toLowerCase()),
  );

  return {
    ...brief,
    garments: uniqueKept.length ? uniqueKept : [],
    must_haves,
    style_direction: style_direction || brief.style_direction,
  };
}
