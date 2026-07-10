/**
 * Print-on-demand / novelty gift merchandise patterns.
 * Scored as penalties (not only pre-filtered) because junk can leak through
 * otherwise-clean queries.
 */
import { GIFT_MERCHANDISE_PENALTY, isGiftMerchandiseTitle } from "./gift-merchandise";

export { GIFT_MERCHANDISE_PENALTY, isGiftMerchandiseTitle };

const NOVELTY_EXTRA_PATTERNS: RegExp[] = [
  /\bby\s+day\b.+\bby\s+night\b/iu,
  /\bfrom\s+friends\b/iu,
  /\b(?:funny|hilarious|sarcastic|witty)\b/iu,
  /\b(?:personal\s+trainer|nurse|teacher|dad|mom|brother|sister)\b.+\b(?:gift|shirt|bracelet|mug)\b/iu,
  /\b(?:shirt|bracelet|mug|hoodie|t-?shirt)\b.+\b(?:gift|birthday)\b/iu,
  /\bunique\s+(?:gift|present)\b/iu,
  /\bperfect\s+for\b/iu,
  /\bnovelty\b/iu,
  /\bprint\s+on\s+demand\b/iu,
  /\bcustom\s+(?:name|text|quote)\b/iu,
];

/** True when the title reads like POD / novelty gift merch. */
export function isNoveltyMerchTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (isGiftMerchandiseTitle(t)) return true;
  return NOVELTY_EXTRA_PATTERNS.some((p) => p.test(t));
}

/** Heavy score penalty — demote rather than rely on pre-filter alone. */
export const NOVELTY_MERCH_PENALTY = 0.85;

/** Combined novelty + gift-merch penalty for scoring. */
export function noveltyMerchPenalty(title: string): number {
  if (!title.trim()) return 0;
  if (isGiftMerchandiseTitle(title)) return GIFT_MERCHANDISE_PENALTY;
  if (isNoveltyMerchTitle(title)) return NOVELTY_MERCH_PENALTY;
  return 0;
}
