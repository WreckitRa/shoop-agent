import type { AlphaSize } from "../normalize/types";
import type { SizeGarmentBucket } from "../intake/garment-size-fields";
import type { FashionFactSizeValue } from "../types";
import type { NormalizedSize } from "../normalize/types";

export type SizeConversionLookup = {
  target: NormalizedSize;
  convertedFrom: string;
};

type ConversionTable = Record<
  string,
  { unambiguous: boolean; map: Record<string, string | number> }
>;

/** EU numeric → alpha for mens tops (stylist-grade, unambiguous). */
const MENS_TOPS_EU_TO_ALPHA: Record<number, AlphaSize> = {
  44: "XS",
  46: "S",
  48: "M",
  50: "L",
  52: "XL",
  54: "XXL",
};

/** Mens shoe EU → US (unambiguous). */
const MENS_SHOES_EU_TO_US: Record<number, number> = {
  40: 7,
  41: 8,
  42: 9,
  43: 10,
  44: 11,
  45: 12,
};

/** Womens shoe EU → US (unambiguous). */
const WOMENS_SHOES_EU_TO_US: Record<number, number> = {
  36: 6,
  37: 6.5,
  38: 7.5,
  39: 8.5,
  40: 9.5,
  41: 10.5,
};

function tableKey(
  department: "mens" | "womens" | "mixed",
  category: SizeGarmentBucket,
): string {
  return `${department}:${category}`;
}

function alphaToEuMensTops(alpha: AlphaSize): number | null {
  for (const [eu, a] of Object.entries(MENS_TOPS_EU_TO_ALPHA)) {
    if (a === alpha) return Number(eu);
  }
  return null;
}

function alphaToEuWomensTops(alpha: AlphaSize): number | null {
  const map: Partial<Record<AlphaSize, number>> = {
    XS: 34,
    S: 36,
    M: 38,
    L: 40,
    XL: 42,
    XXL: 44,
  };
  return map[alpha] ?? null;
}

/**
 * Static cross-system conversions. Only entries marked unambiguous may drive
 * get_product option selection.
 */
export function tryUnambiguousSizeConversion(params: {
  recipient: FashionFactSizeValue;
  department: "mens" | "womens" | "mixed";
  category: SizeGarmentBucket;
}): SizeConversionLookup | null {
  const dept =
    params.department === "mixed" ? "mens" : params.department;
  const key = tableKey(dept, params.category);

  if (params.recipient.system === "alpha") {
    const alpha = String(params.recipient.value).trim().toUpperCase() as AlphaSize;
    if (key === `${dept}:tops` || key === `${dept}:bottoms`) {
      const eu =
        dept === "mens"
          ? alphaToEuMensTops(alpha)
          : alphaToEuWomensTops(alpha);
      if (eu != null) {
        return {
          target: { numeric: eu, numeric_system: "eu" },
          convertedFrom: alpha,
        };
      }
    }
    if (key.endsWith(":shoes")) {
      return null;
    }
  }

  if (
    params.recipient.system === "eu" &&
    params.category === "shoes"
  ) {
    const eu = Number(params.recipient.value);
    const usMap = dept === "womens" ? WOMENS_SHOES_EU_TO_US : MENS_SHOES_EU_TO_US;
    const us = usMap[eu];
    if (us != null) {
      return {
        target: { numeric: us, numeric_system: "us" },
        convertedFrom: `EU ${eu}`,
      };
    }
  }

  if (
    params.recipient.system === "us" &&
    params.category === "shoes"
  ) {
    const us = Number(params.recipient.value);
    const euMap = Object.fromEntries(
      Object.entries(dept === "womens" ? WOMENS_SHOES_EU_TO_US : MENS_SHOES_EU_TO_US).map(
        ([eu, u]) => [String(u), Number(eu)],
      ),
    );
    const eu = euMap[String(us)];
    if (eu != null) {
      return {
        target: { numeric: eu, numeric_system: "eu" },
        convertedFrom: `US ${us}`,
      };
    }
  }

  return null;
}

/** Whether a womens dress numeric ↔ alpha mapping would be ambiguous. */
export function isAmbiguousDressNumericMapping(
  department: "mens" | "womens" | "mixed",
  category: SizeGarmentBucket,
): boolean {
  return department !== "mens" && category === "dresses";
}

export function normalizedSizeMatchesField(
  target: NormalizedSize,
  field: { size: NormalizedSize | null },
): boolean {
  const s = field.size;
  if (!s) return false;
  if (target.one_size && s.one_size) return true;
  if (target.alpha && s.alpha === target.alpha) return true;
  if (
    target.numeric != null &&
    s.numeric != null &&
    target.numeric_system &&
    s.numeric_system === target.numeric_system &&
    s.numeric === target.numeric
  ) {
    return true;
  }
  return false;
}
