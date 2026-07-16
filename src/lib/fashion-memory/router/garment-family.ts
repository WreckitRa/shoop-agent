/**
 * Brief garment-family fidelity: accessories coercion tripwire, known-family
 * checks, and escalation triggers so novel categories pass through instead of
 * being coerced into clothing.
 */
import { hasGarmentTaxonomyMapping } from "../catalog-search/garment-taxonomy";

/** Named accessory nouns (and accessor* stem) used for tripwires. */
export const ACCESSORY_NOUN_RE =
  /\b(accessor(?:y|ies)|belt|belts|watch|watches|tie|ties|necktie|neckwear|bag|bags|handbag|handbags|tote|briefcase|wallet|wallets|bracelet|bracelets|scarf|scarves|hat|hats|cap|caps|sunglasses|eyewear|jewelry|jewellery|cufflinks?|pocket\s*squares?|gloves?|socks?)\b/i;

/** Apparel families the router historically coerced accessories into. */
const CLOTHING_FAMILY_RE =
  /\b(shirt|shirts|top|tops|blouse|tee|t-?shirt|trouser|trousers|pant|pants|jean|jeans|blazer|jacket|coat|dress|dresses|skirt|skirts|shoe|shoes|sneaker|sneakers|sweater|hoodie|suit|chino|chinos|short|shorts|outerwear|knitwear)\b/i;

/** Common shopping nouns that should escalate when unmapped (not silent coerce). */
const COMMON_UNMAPPED_FAMILY_RE =
  /\b(swimwear|swimsuit|bikini|sleepwear|pajamas?|pyjamas?|maternity|sportswear|costume|lingerie|athleisure|activewear|cover-?up)\b/i;

export function userMentionsAccessories(text: string): boolean {
  return ACCESSORY_NOUN_RE.test(text);
}

export function isAccessoryFamilyLabel(garment: string): boolean {
  return ACCESSORY_NOUN_RE.test(garment.trim());
}

export function isClothingFamilyLabel(garment: string): boolean {
  const g = garment.trim();
  if (!g) return false;
  if (isAccessoryFamilyLabel(g)) return false;
  return CLOTHING_FAMILY_RE.test(g);
}

/** Taxonomy-mapped or clearly accessory — otherwise pass-through unknown. */
export function isKnownGarmentFamily(garment: string): boolean {
  const g = garment.trim();
  if (!g) return false;
  if (hasGarmentTaxonomyMapping(g)) return true;
  if (isAccessoryFamilyLabel(g)) return true;
  return false;
}

/**
 * User asked for accessories (generically or by name) but brief.garments is
 * only clothing families — the router destroyed the category.
 */
export function detectAccessoriesCoercion(params: {
  userText: string;
  garments: string[];
}): boolean {
  if (!userMentionsAccessories(params.userText)) return false;
  if (!params.garments.length) return false;
  const hasAccessoryGarment = params.garments.some(isAccessoryFamilyLabel);
  if (hasAccessoryGarment) return false;
  return params.garments.every(isClothingFamilyLabel);
}

export function unknownGarmentsInBrief(garments: string[]): string[] {
  return garments.filter((g) => g.trim() && !isKnownGarmentFamily(g));
}

export function isCommonUnmappedFamily(garment: string): boolean {
  return COMMON_UNMAPPED_FAMILY_RE.test(garment.trim());
}

export type RouterEscalationReason =
  | "accessories_coerced"
  | "unknown_family_common"
  | "validation_retry";

export function assessRouterEscalation(params: {
  userText: string;
  garments?: string[];
  /** Clarification asked clothing sizes for an accessories ask. */
  askedClothingSizesForAccessories?: boolean;
  /** True for gate_retry / router_retry stages. */
  validationRetry?: boolean;
}): RouterEscalationReason[] {
  const reasons: RouterEscalationReason[] = [];
  const garments = params.garments ?? [];
  if (
    detectAccessoriesCoercion({
      userText: params.userText,
      garments,
    }) ||
    params.askedClothingSizesForAccessories
  ) {
    reasons.push("accessories_coerced");
  }
  if (garments.some((g) => !isKnownGarmentFamily(g) && isCommonUnmappedFamily(g))) {
    reasons.push("unknown_family_common");
  }
  if (params.validationRetry) {
    reasons.push("validation_retry");
  }
  return reasons;
}

export function latestUserText(
  messages: Array<{ role: string; content: string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && m.content.trim()) return m.content;
  }
  return "";
}
