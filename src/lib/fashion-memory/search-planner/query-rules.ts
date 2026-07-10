/** Shared query-building rules for catalog search variants. */

export const COLOR_WORDS = new Set([
  "black",
  "white",
  "navy",
  "blue",
  "red",
  "green",
  "beige",
  "brown",
  "grey",
  "gray",
  "pink",
  "purple",
  "yellow",
  "orange",
  "cream",
  "olive",
  "tan",
  "charcoal",
  "ivory",
  "burgundy",
  "maroon",
  "teal",
  "coral",
]);

/**
 * Banned in query strings — recipient / occasion / size / budget noise.
 *
 * DEPARTMENT words (mens, womens, boys, girls, baby) are NOT banned —
 * they are REQUIRED retail vocabulary for gendered searches (see
 * ensureDepartmentQueryPrefix). Do not add them here.
 */
export const BANNED_QUERY_PATTERNS: RegExp[] = [
  /\b(size|sizes)\b/i,
  /\b(xxs|xs|s|m|l|xl|xxl|xxxl)\b/i,
  /\b(small|medium|large|xlarge|extra[- ]?large)\b/i,
  /\b(eu|us|uk)\s*[-]?\s*\d{1,2}\b/i,
  /\bw\d{2}\b/i,
  /\b\d{2}\s*x\s*\d{2}\b/i,
  /\b(w\d{2}|\d{2}w)\b/i,
  // Recipient references — NOT department retail words (mens/womens/boys/…).
  /\b(brother|sister|wife|husband|mom|mother|dad|father|friend|colleague|him|her|gift|girlfriend|boyfriend|son|daughter)\b/i,
  /\bfor my\b/i,
  /\bfor (work|office|school|church|a wedding|the wedding|him|her|them)\b/i,
  /\boffice wear\b/i,
  /\bwedding guest\b/i,
  /\b(price|budget|cheap|expensive|affordable|under|over|\$\d|usd|eur|gbp|£|€)\b/i,
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|pair|pairs|dozen|show me)\b/i,
  /\b\d+\s+(shirt|shirts|pant|pants|trouser|trousers|shoe|shoes|dress|dresses)\b/i,
  // Outfit / quantity-adjacent noise (must stay in sync with planner prompt).
  /\boutfit\b/i,
  /\blook\b/i,
  /\bcapsule\b/i,
  /\b(full|complete|entire|whole)\b/i,
  /\bhead[\s-]?to[\s-]?toe\b/i,
];

export const MAX_VARIANT_TOKEN_OVERLAP = 0.6;
export const MIN_QUERY_VARIANTS = 2;
export const MAX_QUERY_VARIANTS = 3;
