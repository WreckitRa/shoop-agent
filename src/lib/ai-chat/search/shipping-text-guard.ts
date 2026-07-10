/**
 * Title/description shipping exclusion guard (search hardening Fix 4).
 *
 * Catches restrictions stated in listing text that structured `ships_to`
 * filters may miss (e.g. "No US Customers please").
 */
import type {
  CatalogProductDetail,
  CatalogProductSummary,
} from "@/lib/shopify/catalog";

const EXCLUSION_PATTERNS: Array<{ re: RegExp; countries?: string[] }> = [
  { re: /\bno\s+us\b/i, countries: ["US"] },
  { re: /\bno\s+usa\b/i, countries: ["US"] },
  { re: /\bnot\s+for\s+us\b/i, countries: ["US"] },
  { re: /\bus\s+customers?\s+please\b/i, countries: ["US"] },
  { re: /\bnot\s+available\s+in\s+(?:the\s+)?us\b/i, countries: ["US"] },
  { re: /\bno\s+international\b/i },
  { re: /\buk\s+only\b/i, countries: ["GB"] },
  { re: /\beu\s+only\b/i, countries: ["EU"] },
  { re: /\beurope\s+only\b/i, countries: ["EU"] },
  { re: /\bships?\s+only\s+to\b/i },
  { re: /\b(?:not|no)\s+shipp(?:ing|ed)\s+to\b/i },
];

const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["us", "usa", "u.s.", "u.s.a.", "united states", "america"],
  GB: ["uk", "u.k.", "united kingdom", "britain", "great britain"],
  EU: ["eu", "europe", "european union"],
  CA: ["canada", "ca"],
  AU: ["australia", "au"],
};

function normalizeCountry(code: string): string {
  return code.trim().toUpperCase();
}

function textImpliesExcludedCountry(text: string, buyerCountry: string): boolean {
  const hay = text.toLowerCase();
  const code = normalizeCountry(buyerCountry);
  const aliases = COUNTRY_ALIASES[code] ?? [code.toLowerCase()];
  for (const alias of aliases) {
    if (hay.includes(`not ${alias}`)) return true;
    if (hay.includes(`no ${alias}`)) return true;
    if (hay.includes(`excluding ${alias}`)) return true;
    if (hay.includes(`${alias} excluded`)) return true;
  }
  return false;
}

export function listingTextFromProduct(
  product: CatalogProductSummary | CatalogProductDetail,
): string {
  const raw = product as unknown as Record<string, unknown>;
  const desc =
    typeof raw.description === "string"
      ? raw.description
      : typeof raw.body_html === "string"
        ? raw.body_html.replace(/<[^>]+>/g, " ")
        : "";
  return `${product.title ?? ""} ${desc}`.trim();
}

/**
 * Returns false when listing text clearly excludes the buyer's country.
 * Bias toward dropping borderline cases.
 */
export function passesShippingTextGuard(
  text: string,
  buyerCountry = "US",
): boolean {
  const hay = text.toLowerCase();
  if (!hay.trim()) return true;

  if (textImpliesExcludedCountry(hay, buyerCountry)) return false;

  for (const { re, countries } of EXCLUSION_PATTERNS) {
    if (!re.test(hay)) continue;
    if (!countries?.length) return false;
    if (countries.includes("EU")) {
      const euMembers = ["DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT"];
      if (euMembers.includes(normalizeCountry(buyerCountry))) return false;
      if (normalizeCountry(buyerCountry) === "EU") return false;
      continue;
    }
    if (countries.includes(normalizeCountry(buyerCountry))) return false;
  }

  // Negating context around "us customers please" (the logged failure case).
  if (
    /\bno\b[^.]{0,40}\bus\b/i.test(hay) ||
    /\bnot\b[^.]{0,40}\bus\b/i.test(hay)
  ) {
    if (normalizeCountry(buyerCountry) === "US") return false;
  }

  return true;
}

export function productPassesShippingTextGuard(
  product: CatalogProductSummary | CatalogProductDetail,
  buyerCountry?: string,
): boolean {
  if (!buyerCountry?.trim()) return true;
  return passesShippingTextGuard(
    listingTextFromProduct(product),
    buyerCountry,
  );
}
