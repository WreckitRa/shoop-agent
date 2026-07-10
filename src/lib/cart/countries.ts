export const SHOPIFY_COUNTRY_CODES = [
  "AF", "AX", "AL", "DZ", "AD", "AO", "AI", "AG", "AR", "AM", "AW", "AC", "AU", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BA", "BW", "BV", "BR",
  "IO", "BN", "BG", "BF", "BI", "KH", "CA", "CV", "BQ", "KY", "CF", "TD", "CL", "CN", "CX",
  "CC", "CO", "KM", "CG", "CD", "CK", "CR", "HR", "CU", "CW", "CY", "CZ", "CI", "DK", "DJ",
  "DM", "DO", "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FK", "FO", "FJ", "FI", "FR",
  "GF", "PF", "TF", "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GT", "GG",
  "GN", "GW", "GY", "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE",
  "IM", "IL", "IT", "JM", "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "XK", "KW", "KG", "LA",
  "LV", "LB", "LS", "LR", "LY", "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT",
  "MQ", "MR", "MU", "YT", "MX", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR",
  "NP", "NL", "AN", "NC", "NZ", "NI", "NE", "NG", "NU", "NF", "MK", "NO", "OM", "PK", "PS",
  "PA", "PG", "PY", "PE", "PH", "PN", "PL", "PT", "QA", "CM", "RE", "RO", "RU", "RW", "BL",
  "SH", "KN", "LC", "MF", "PM", "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX",
  "SK", "SI", "SB", "SO", "ZA", "GS", "KR", "SS", "ES", "LK", "VC", "SD", "SR", "SJ", "SE",
  "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO", "TT", "TA", "TN", "TR", "TM",
  "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU", "VE", "VN", "VG", "WF",
  "EH", "YE", "ZM", "ZW", "ZZ", "UNKNOWN__",
] as const;

export type ShopifyCountryCode = (typeof SHOPIFY_COUNTRY_CODES)[number];

const COUNTRY_LABEL_OVERRIDES: Record<string, string> = {
  AC: "Ascension Island",
  AN: "Netherlands Antilles",
  BQ: "Caribbean Netherlands",
  CI: "Cote d'Ivoire",
  TA: "Tristan da Cunha",
  XK: "Kosovo",
  ZZ: "Unknown Region",
  UNKNOWN__: "Unknown",
};

const COUNTRY_INPUT_ALIASES: Record<string, string> = {
  USA: "US",
  "U.S.": "US",
  "U.S.A.": "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  UK: "GB",
  GBR: "GB",
  "GREAT BRITAIN": "GB",
  "UNITED KINGDOM": "GB",
};

const displayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export function shopifyCountryLabel(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (COUNTRY_LABEL_OVERRIDES[normalized]) return COUNTRY_LABEL_OVERRIDES[normalized];
  try {
    return displayNames?.of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
}

export const SHOPIFY_COUNTRIES = SHOPIFY_COUNTRY_CODES
  .map((code) => ({ code, label: shopifyCountryLabel(code) }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function normalizeShopifyCountryInput(raw: string): string {
  const cleaned = raw.trim();
  const upper = cleaned.toUpperCase();
  const alias = COUNTRY_INPUT_ALIASES[upper];
  if (alias) return alias;
  if ((SHOPIFY_COUNTRY_CODES as readonly string[]).includes(upper)) return upper;

  const byLabel = SHOPIFY_COUNTRIES.find(
    (country) => country.label.toUpperCase() === upper,
  );
  return byLabel?.code ?? upper;
}
