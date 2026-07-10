/** Lightweight option-axis detection for PDP variant UI. */

export function isColorOptionName(name: string): boolean {
  return /(color|colour|colorway|finish|hue)/i.test(name);
}

export function isSizeOptionName(name: string): boolean {
  return /size/i.test(name);
}

export function isMonogramOptionName(name: string): boolean {
  return /(monogram|personaliz|engrav|initial)/i.test(name);
}

export function splitBrandTitle(title: string): { brand: string; productName: string } {
  const trimmed = title.trim();
  const space = trimmed.indexOf(" ");
  if (space <= 0) return { brand: "", productName: trimmed };
  return {
    brand: trimmed.slice(0, space).toUpperCase(),
    productName: trimmed.slice(space + 1),
  };
}

export type CatalogVariantAvailability = {
  available?: boolean;
  status?: string;
  running_low?: boolean;
};

export type StockStatusDisplay = {
  tone: "in_stock" | "low_stock" | "out_of_stock";
  label: string;
};

const OUT_OF_STOCK_STATUS = /out[_\s-]?of[_\s-]?stock|sold[_\s-]?out|unavailable/i;
const IN_STOCK_STATUS = /in[_\s-]?stock|^available$/i;

/** Option-level `available` for the buyer's current picks (when variant block is missing). */
export function selectionAvailabilitySignal(
  options:
    | Array<{
        name: string;
        values: Array<{ label: string; available?: boolean }>;
      }>
    | undefined,
  selected: Record<string, string>,
): boolean | null {
  if (!options?.length) return null;
  let sawSignal = false;
  for (const opt of options) {
    const label = selected[opt.name];
    if (!label) continue;
    const value = opt.values.find((v) => v.label === label);
    if (value?.available === undefined) continue;
    sawSignal = true;
    if (value.available === false) return false;
  }
  return sawSignal ? true : null;
}

/**
 * Normalize catalog variant availability for PDP display.
 * Prefers variant.availability; falls back to checkout + option signals.
 */
export function resolveStockStatus(
  availability: CatalogVariantAvailability | null | undefined,
  hints?: {
    hasCheckoutUrl?: boolean;
    selectionAvailable?: boolean | null;
  },
): StockStatusDisplay | null {
  const status = availability?.status?.trim().toLowerCase();

  if (
    availability?.available === false ||
    (status && OUT_OF_STOCK_STATUS.test(status))
  ) {
    return { tone: "out_of_stock", label: "Out of stock" };
  }

  const explicitlyInStock =
    availability?.available === true ||
    (status != null && IN_STOCK_STATUS.test(status));

  if (explicitlyInStock) {
    const label = availability?.running_low
      ? "In stock · Running low"
      : "In stock · Ready to ship";
    return {
      tone: availability?.running_low ? "low_stock" : "in_stock",
      label,
    };
  }

  if (availability?.running_low) {
    return { tone: "low_stock", label: "In stock · Running low" };
  }

  if (hints?.selectionAvailable === false) {
    return {
      tone: "out_of_stock",
      label: "Out of stock for this selection",
    };
  }

  return null;
}

/** Split curator reason into short bullet lines for the sidebar. */
export function curationReasonBullets(reason: string, max = 3): string[] {
  const chunks = reason
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length >= 2) return chunks.slice(0, max);
  return [reason.trim()].filter(Boolean);
}
