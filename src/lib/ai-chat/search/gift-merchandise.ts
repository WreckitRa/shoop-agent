/**
 * Detect catalog hits that are "gift merchandise" (gift boxes, gift sets, etc.)
 * rather than products someone would actually want to receive.
 */
const GIFT_MERCH_PATTERNS: RegExp[] = [
  /\bgift\s*(?:box|set|basket|bag|card|wrap|kit|bundle|pack|idea|guide|certificate)s?\b/iu,
  /\b(?:perfect|great|unique|best|ideal|funny)\s+gift\b/iu,
  /\bgifts?\s+for\s+(?:him|her|men|women|dad|mom|boy|girl|teen|adults?)\b/iu,
  /\b(?:birthday|holiday|christmas|valentine'?s?)\s+gift\b/iu,
  /\bgift\s*(?:for|giving)\b/iu,
  /\bnovelty\s+gift\b/iu,
];

export function isGiftMerchandiseTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  return GIFT_MERCH_PATTERNS.some((p) => p.test(t));
}

/** Heavy score penalty so real products rank above gift-themed trinkets. */
export const GIFT_MERCHANDISE_PENALTY = 0.9;
