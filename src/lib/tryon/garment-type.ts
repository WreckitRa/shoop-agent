import type { GarmentType } from "./types";
import {
  garmentTypeFromSlot,
  isAccessoryGarment,
} from "./providers/mock-providers";

export { garmentTypeFromSlot, isAccessoryGarment };

const SUPPORTED: GarmentType[] = [
  "top",
  "bottom",
  "shoes",
  "dress",
  "outerwear",
];

export function isGarmentTypeSupported(garment: string): boolean {
  return (
    garmentTypeFromSlot(garment) !== null || isAccessoryGarment(garment)
  );
}

/** Resolve type from slot label, then product title (e.g. "Beo Blazer"). */
export function mapSlotToGarmentType(
  garment: string,
  title?: string,
): GarmentType | null {
  return (
    garmentTypeFromSlot(garment) ??
    (title ? garmentTypeFromSlot(title) : null)
  );
}

/**
 * Dress/base layer first, then separates, then shoes.
 * One-pieces must not run after tops/bottoms — that wipes the outfit.
 */
export function outfitChainOrder(): GarmentType[] {
  return ["dress", "top", "bottom", "outerwear", "shoes"];
}

function isClearOnePiece(garment: string): boolean {
  const g = garment.toLowerCase();
  return (
    /\b(jumpsuit|romper|playsuit|gown|sundress|maxi dress|midi dress|mini dress|shirt dress)\b/.test(
      g,
    ) ||
    (/\bdress\b/.test(g) && !/\bshirt\b/.test(g))
  );
}

/**
 * Build the outfit dress list for FASHN collage / chain.
 * Includes suits (→ outerwear) and accessories (ties, etc.) for collage.
 */
export function sortRefsForOutfitChain(
  items: Array<{ ref: string; garment: string; title?: string }>,
): Array<{
  ref: string;
  garment: string;
  type: GarmentType;
  /** Soft accessory — collage only; skip in sequential layering. */
  accessory?: boolean;
}> {
  const order = outfitChainOrder();
  let mapped = items
    .map((item) => {
      const type = mapSlotToGarmentType(item.garment, item.title);
      if (type && SUPPORTED.includes(type)) {
        return { ref: item.ref, garment: item.garment, type };
      }
      // tryon-max supports ties/hats/etc. via collage product image.
      if (
        isAccessoryGarment(item.garment) ||
        (item.title ? isAccessoryGarment(item.title) : false)
      ) {
        return {
          ref: item.ref,
          garment: item.garment,
          type: "top" as GarmentType,
          accessory: true,
        };
      }
      return null;
    })
    .filter(Boolean) as Array<{
    ref: string;
    garment: string;
    type: GarmentType;
    accessory?: boolean;
  }>;

  const hasSeparates = mapped.some(
    (m) => !m.accessory && (m.type === "top" || m.type === "bottom"),
  );
  if (hasSeparates) {
    mapped = mapped.filter(
      (m) =>
        m.accessory ||
        m.type !== "dress" ||
        isClearOnePiece(m.garment),
    );
    if (mapped.some((m) => !m.accessory && (m.type === "top" || m.type === "bottom"))) {
      mapped = mapped.filter((m) => m.accessory || m.type !== "dress");
    }
  }

  return mapped.sort((a, b) => {
    // Accessories after matching base layers (shirt then tie then blazer).
    if (a.accessory !== b.accessory) return a.accessory ? 1 : -1;
    return order.indexOf(a.type) - order.indexOf(b.type);
  });
}
