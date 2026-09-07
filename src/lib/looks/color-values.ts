import type { ColorFamily } from "@/lib/photo-analysis/style-contract";

/**
 * Shopify taxonomy `Color` attribute values for a contract family.
 * OR within the filter. Dual-search still runs without Color because
 * merchants often leave the attribute empty.
 */
const FAMILY_COLOR_VALUES: Record<ColorFamily, string[]> = {
  black: ["Black"],
  white: ["White", "Ivory", "Cream"],
  grey: ["Grey", "Gray"],
  beige: ["Beige", "Ivory", "Cream", "Tan"],
  brown: ["Brown", "Tan"],
  navy: ["Navy", "Blue"],
  blue: ["Blue"],
  green: ["Green"],
  olive: ["Green", "Olive"],
  red: ["Red"],
  burgundy: ["Red", "Burgundy", "Maroon"],
  pink: ["Pink"],
  purple: ["Purple"],
  orange: ["Orange"],
  yellow: ["Yellow"],
  gold: ["Gold"],
  silver: ["Silver"],
  denim: ["Blue", "Navy"],
  multi: ["Multicolor", "Multi"],
  print: ["Multicolor", "Multi"],
};

export function taxonomyColorValues(family: ColorFamily): string[] {
  return FAMILY_COLOR_VALUES[family];
}

export type SpendPriceTier = Array<"low" | "medium" | "high">;

/** Map onboarding spend philosophy → Global Catalog `price_tier`. */
export function spendTierFor(valuePhilosophy: string | null | undefined): SpendPriceTier | undefined {
  const raw = (valuePhilosophy ?? "").toLowerCase();
  if (!raw.trim()) return undefined;
  if (/\b(deal_hunter|deal hunter|best_value|smart value|deals)\b/.test(raw)) {
    return ["low", "medium"];
  }
  if (/\b(luxury|design_first|design-led|design led)\b/.test(raw)) {
    return ["high", "medium"];
  }
  if (/\b(premium|quality)\b/.test(raw)) {
    return ["medium", "high"];
  }
  return undefined;
}
