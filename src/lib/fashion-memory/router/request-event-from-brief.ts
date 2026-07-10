import { safeTrim } from "../safe-trim";
import type { FashionSearchBrief } from "./types";
import type { RequestEventAttributes } from "../types";

const COLOR_WORDS =
  /\b(black|white|navy|blue|red|green|beige|brown|grey|gray|pink|purple|yellow|orange|cream|olive|tan|charcoal|ivory|burgundy|maroon|teal|coral)\b/i;

const MATERIAL_WORDS =
  /\b(linen|cotton|wool|silk|polyester|cashmere|leather|denim|suede|viscose|nylon|elastane|spandex|merino|fleece|canvas|satin|velvet|chiffon)\b/i;

const STYLE_WORDS =
  /\b(minimalist|classic|casual|formal|streetwear|preppy|bohemian|sporty|elegant|relaxed|tailored|oversized|slim|vintage|modern|monochrome)\b/i;

function firstMatch(text: string, pattern: RegExp): string | undefined {
  const hit = text.match(pattern);
  return hit?.[1]?.toLowerCase();
}

function scanAttributeHints(texts: string[]): RequestEventAttributes {
  const joined = texts.join(" ").toLowerCase();
  const attrs: RequestEventAttributes = {};

  const color = firstMatch(joined, COLOR_WORDS);
  if (color) attrs.color = color;

  const material = firstMatch(joined, MATERIAL_WORDS);
  if (material) attrs.material = material;

  const style = firstMatch(joined, STYLE_WORDS);
  if (style) attrs.style = style;

  return attrs;
}

/** Deterministic episodic request attributes from a router brief (no LLM). */
export function requestAttributesFromBrief(
  brief: FashionSearchBrief,
): RequestEventAttributes {
  const attrs: RequestEventAttributes = {
    occasion: safeTrim(brief.occasion_context),
    request_type: brief.request_type,
    quantity_hint: safeTrim(brief.quantity_hint),
    style_direction: safeTrim(brief.style_direction),
  };

  if (brief.garments.length === 1) {
    attrs.garment = safeTrim(brief.garments[0]).toLowerCase();
  } else if (brief.garments.length > 1) {
    attrs.garment = brief.garments
      .map((g) => safeTrim(g).toLowerCase())
      .filter(Boolean)
      .join(", ");
  }

  const hintTexts = [...brief.must_haves, ...brief.nice_to_haves];
  Object.assign(attrs, scanAttributeHints(hintTexts));

  if (
    brief.brand_direction?.source === "stated" &&
    brief.brand_direction.brands?.length
  ) {
    attrs.brand = brief.brand_direction.brands.join(", ");
  }

  if (brief.budget_context.stated) {
    if (brief.budget_context.max != null) {
      attrs.budget_max = String(brief.budget_context.max);
    }
    if (brief.budget_context.min != null) {
      attrs.budget_min = String(brief.budget_context.min);
    }
    if (brief.budget_context.currency) {
      attrs.currency = brief.budget_context.currency;
    }
  }

  return attrs;
}
