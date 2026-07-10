/**
 * Deterministic local gate: preference verb + product/category (and related rules).
 * Runs before the optional LLM classifier in `pipeline.ts`.
 */

export function normalizeForMemoryGate(input: string): string {
  return input
    .toLowerCase()
    .replace(/\bbalck\b/g, "black")
    .replace(/\bsneacker\b/g, "sneaker")
    .replace(/\bsneackers\b/g, "sneakers")
    .replace(/\bshooes\b/g, "shoes")
    .replace(/\bperfumees\b/g, "perfumes")
    .trim();
}

const preferencePattern =
  /\b(i|we|my wife|my husband|my brother|my sister|my mom|my dad)\b.*\b(love|like|prefer|hate|dislike|avoid|want|need|wear|use|own|bought|returned|looking for)\b/i;

const productPattern =
  /\b(sneakers?|shoes?|boots?|loafers?|sandals?|shirt|t-?shirt|pants|jeans|hoodie|jacket|coat|watch(?:es)?|perfume|fragrance|bag|wallet|belt|laptop|phone|headphones?|chair|desk|gift|dress|suit|shorts|sunglasses|ring|bracelet|supplements?|vitamins?|protein\s+powder|creatine|collagen|probiotics?|pre[-\s]?workout|multivitamins?)\b/i;

const shoppingAttributePattern =
  /\b(black|white|blue|green|red|beige|brown|leather|suede|cotton|linen|slim|regular|oversized|chunky|minimal|clean|premium|cheap|luxury|size|small|medium|large|xl|eu\s?\d{2}|\d{2}w|\d{2}l)\b/i;

// Identity / lifestyle hints that matter to a personal shopper but may not
// mention a product directly. We want the projector to pick up things like
// "I'm 28, based in Beirut, USD usually" even outside a shopping turn.
const identityPattern =
  /\b(i'?m|i am|im)\s+\d{1,2}\b|\bage[d]?\s+\d{1,2}\b|\bbased\s+(?:in|out\s+of)\b|\b(?:i\s+live|live)\s+in\b|\bfrom\s+(?:lebanon|beirut|dubai|uae|saudi|riyadh|jeddah|qatar|kuwait|bahrain|egypt|jordan|usa|america|us|uk|canada|france|germany|italy|spain|japan|china|india|australia|brazil|mexico|turkey|morocco|tunisia)\b/i;

const currencyPattern = /\b(usd|eur|gbp|aed|sar|lbp|qar|kwd|bhd|egp|try)\b/i;

const sizingExplicitPattern =
  /\b(my\s+size|i'?m|im|i\s+am)\s+(?:a\s+)?(?:size\s+)?(?:xs|s|m|l|xl|xxl|small|medium|large|\d{2,3}(?:w|l)?)|\b(?:shoe|sneaker|foot)\s*size\b|\beu\s?\d{2}\b|\bus\s?\d{1,2}(?:\.\d)?\b|\b\d{2}w\b|\b\d{2}l\b/i;

const giftPattern =
  /\bgift\s+for\b|\bfor\s+(?:my\s+)?(?:wife|husband|brother|sister|mom|dad|mother|father|son|daughter|friend|boss|colleague|partner|girlfriend|boyfriend|spouse|parents?)\b/i;

const occasionPattern =
  /\b(wedding|birthday|anniversary|christmas|hanukkah|eid|ramadan|valentine|graduation|interview|honeymoon|ski\s+trip|business\s+trip|engagement|baby\s+shower)\b/i;

const hardNegativePattern =
  /\b(allerg(?:ic|y|ies)|never\s+(?:show|recommend|suggest|buy)|don'?t\s+(?:show|recommend|suggest)|cannot\s+wear|can'?t\s+wear|won'?t\s+wear|i\s+only\s+wear|kosher|halal|vegan|vegetarian|cruelty[-\s]free|fragrance[-\s]free|hypoallergenic|nickel[-\s]free|gluten[-\s]free)\b/i;

/** Single-line pleasantries — skip memory extraction unless ALWAYS_EXTRACT is on. */
export const TRIVIAL_MEMORY_GREETING =
  /^(hi|hello|hey|thanks|thank you|ty|thx|ok|okay|yes|no|bye|goodbye)\s*[!.?]*$/i;

export function isTrivialMemoryMessage(text: string): boolean {
  return TRIVIAL_MEMORY_GREETING.test(text.trim());
}

export function shouldRunShoppingExtractor(userMessage: string): boolean {
  const text = normalizeForMemoryGate(userMessage);

  const hasPreference = preferencePattern.test(text);
  const hasProduct = productPattern.test(text);
  const hasShoppingAttribute = shoppingAttributePattern.test(text);

  if (hasPreference && hasProduct) return true;
  if (hasPreference && hasShoppingAttribute) return true;
  if (/\b(size|wear|usually wear|my size)\b/i.test(text)) return true;
  if (
    /\b(nothing|avoid|hate|dislike|never)\b/i.test(text) &&
    hasShoppingAttribute
  ) {
    return true;
  }

  /** Preference verb near product without requiring "I" / "we" (e.g. "really love sneakers"). */
  if (
    /\b(love|like|prefer|hate|dislike|avoid|want|need)\b/i.test(text) &&
    hasProduct
  ) {
    return true;
  }

  // Identity / lifestyle context useful for the typed profile projection,
  // even when no product is mentioned.
  if (identityPattern.test(text)) return true;
  if (currencyPattern.test(text)) return true;
  if (sizingExplicitPattern.test(text)) return true;
  if (giftPattern.test(text)) return true;
  if (occasionPattern.test(text)) return true;
  if (hardNegativePattern.test(text)) return true;

  return false;
}
