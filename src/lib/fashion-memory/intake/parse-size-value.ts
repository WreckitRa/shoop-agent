import type { FashionFactSizeValue } from "../types";

/**
 * Parse user/onboarding size strings into fashion_facts.size shape.
 * Supports alpha (incl. 3XL), EU/US shoe numbers, and WxL bottoms.
 */
export function parseSizeValue(raw: string): FashionFactSizeValue {
  const trimmed = raw.trim();
  const t = trimmed.toUpperCase().replace(/\s+/g, "");

  const waistInseam = t.match(/^(\d{2,3})[X/](\d{2})$/);
  if (waistInseam) {
    return {
      system: "waist_inseam",
      value: {
        waist: Number(waistInseam[1]),
        inseam: Number(waistInseam[2]),
      },
    };
  }

  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL)$/.test(t)) {
    const alpha = t === "3XL" ? "XXXL" : t;
    return { system: "alpha", value: alpha };
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    // EU shoe / clothing numbers commonly land 35–50; US shoes 5–15.
    if (numeric >= 35 && numeric <= 50) return { system: "eu", value: numeric };
    if (numeric >= 5 && numeric <= 15) return { system: "us", value: numeric };
    // Waist-only bottoms (24–44) — store as US-ish numeric for matching.
    if (numeric >= 24 && numeric <= 44) return { system: "us", value: numeric };
    return { system: "us", value: numeric };
  }

  return { system: "alpha", value: trimmed };
}
