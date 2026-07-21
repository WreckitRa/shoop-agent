import {
  SHOPIFY_COUNTRIES,
  shopifyCountryLabel,
} from "@/lib/cart/countries";

export type DetectedRequestArea = {
  countryCode: string;
  countryLabel: string;
  cityLabel: string | null;
};

function cleanHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, " ")).trim();
    return decoded && decoded.length <= 80 ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Uses coarse geo metadata supplied by a trusted deployment proxy. It never
 * reads, stores, or sends the buyer's raw IP to a third party.
 */
export function detectRequestArea(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
): DetectedRequestArea | null {
  let countryCode: string | null = null;
  let cityLabel: string | null = null;

  if (env.VERCEL === "1") {
    countryCode = cleanHeader(headers.get("x-vercel-ip-country"));
    cityLabel = cleanHeader(headers.get("x-vercel-ip-city"));
  } else if (headers.has("cf-ray")) {
    countryCode = cleanHeader(headers.get("cf-ipcountry"));
    cityLabel = cleanHeader(headers.get("cf-ipcity"));
  } else if (env.TRUST_PROXY_GEO_HEADERS === "1") {
    countryCode = cleanHeader(headers.get("x-geo-country"));
    cityLabel = cleanHeader(headers.get("x-geo-city"));
  }

  const normalizedCode = countryCode?.toUpperCase();
  if (
    !normalizedCode ||
    normalizedCode.length !== 2 ||
    normalizedCode === "XX" ||
    !SHOPIFY_COUNTRIES.some((country) => country.code === normalizedCode)
  ) {
    return null;
  }

  const countryLabel = shopifyCountryLabel(normalizedCode);
  if (!countryLabel) return null;

  return {
    countryCode: normalizedCode,
    countryLabel,
    cityLabel,
  };
}
