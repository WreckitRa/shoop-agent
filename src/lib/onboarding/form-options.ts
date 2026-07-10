import { SHOPIFY_COUNTRIES } from "@/lib/cart/countries";

export const AGE_RANGES = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;

export const GENDER_OPTIONS = [
  { value: "masculine", label: "Masculine" },
  { value: "feminine", label: "Feminine" },
  { value: "androgynous", label: "Androgynous" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "prefer not to say", label: "Prefer not to say" },
] as const;

export const BUDGET_OPTIONS = [
  { value: "best_value", label: "Smart value", hint: "Quality without overspending" },
  { value: "premium", label: "Quality first", hint: "Invest in pieces that last" },
  { value: "luxury", label: "Luxury & designer", hint: "Top-tier brands welcome" },
  { value: "deal_hunter", label: "Deal hunter", hint: "Sales and value drives me" },
  { value: "design_first", label: "Design-led", hint: "Aesthetics over price" },
] as const;

export const TOP_SIZES = [
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL",
  "32", "34", "36", "38", "40", "42", "44", "46",
] as const;

export const BOTTOM_SIZES = [
  "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "36", "38",
  "28x28", "28x30", "30x30", "30x32", "32x30", "32x32", "32x34", "33x30", "34x32", "34x34",
  "36x32", "36x34", "38x32",
] as const;

export const SHOE_EU_SIZES = Array.from({ length: 20 }, (_, i) => String(35 + i));

export const STYLE_SUGGESTIONS = [
  "minimal", "classic", "streetwear", "old money", "gorpcore", "preppy",
  "bohemian", "sporty", "tailored", "casual", "avant-garde", "vintage",
  "neutral tones", "bold colors", "quiet luxury",
] as const;

export const BRAND_SUGGESTIONS = [
  "Nike", "Adidas", "Uniqlo", "Zara", "H&M", "Aesop", "Apple", "Patagonia",
  "Lululemon", "COS", "Arket", "Muji", "Levi's", "New Balance", "Gucci",
  "Prada", "Loro Piana", "Everlane", "Reformation", "Sephora",
] as const;

export const HARD_AVOID_SUGGESTIONS = [
  "leather", "wool", "nickel", "fur", "fast fashion", "synthetic fragrances",
  "animal products", "logo-heavy", "dry clean only",
] as const;

export const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "BRL", label: "BRL — Brazilian Real" },
  { value: "MXN", label: "MXN — Mexican Peso" },
  { value: "KRW", label: "KRW — South Korean Won" },
  { value: "CNY", label: "CNY — Chinese Yuan" },
  { value: "HKD", label: "HKD — Hong Kong Dollar" },
  { value: "NZD", label: "NZD — New Zealand Dollar" },
  { value: "SEK", label: "SEK — Swedish Krona" },
  { value: "NOK", label: "NOK — Norwegian Krone" },
  { value: "DKK", label: "DKK — Danish Krone" },
  { value: "PLN", label: "PLN — Polish Zloty" },
  { value: "TRY", label: "TRY — Turkish Lira" },
  { value: "ZAR", label: "ZAR — South African Rand" },
  { value: "LBP", label: "LBP — Lebanese Pound" },
] as const;

export const COUNTRY_OPTIONS = SHOPIFY_COUNTRIES.filter(
  (c) => !["ZZ", "UNKNOWN__"].includes(c.code),
).map((c) => ({
  value: c.label,
  label: c.label,
  hint: c.code,
}));

/** Suggest a currency when the user picks a country (only if currency is empty). */
export const COUNTRY_CURRENCY_HINT: Record<string, string> = {
  US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR",
  BE: "EUR", AT: "EUR", IE: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR",
  JP: "JPY", AU: "AUD", CA: "CAD", CH: "CHF", SG: "SGD", AE: "AED", SA: "SAR",
  IN: "INR", BR: "BRL", MX: "MXN", KR: "KRW", CN: "CNY", HK: "HKD", NZ: "NZD",
  SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", TR: "TRY", ZA: "ZAR", LB: "LBP",
};

export function currencyHintForCountry(countryLabel: string): string | null {
  const match = SHOPIFY_COUNTRIES.find((c) => c.label === countryLabel);
  if (!match) return null;
  return COUNTRY_CURRENCY_HINT[match.code] ?? null;
}

export function normalizeGender(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const t = raw.trim().toLowerCase();
  if (GENDER_OPTIONS.some((g) => g.value === t)) return t;
  const aliases: Record<string, (typeof GENDER_OPTIONS)[number]["value"]> = {
    male: "masculine",
    man: "masculine",
    m: "masculine",
    female: "feminine",
    woman: "feminine",
    f: "feminine",
    "non-binary": "nonbinary",
    nonbinary: "nonbinary",
    nb: "nonbinary",
  };
  return aliases[t] ?? raw.trim();
}

export function normalizeAgeRange(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const t = raw.trim();
  if ((AGE_RANGES as readonly string[]).includes(t)) return t;
  const ageMatch = t.match(/\b(\d{1,2})\b/);
  const n = ageMatch ? Number(ageMatch[1]) : Number.NaN;
  if (!Number.isNaN(n)) {
    if (n < 18) return "13-17";
    if (n < 25) return "18-24";
    if (n < 35) return "25-34";
    if (n < 45) return "35-44";
    if (n < 55) return "45-54";
    if (n < 65) return "55-64";
    return "65+";
  }
  return t;
}

export function genderLabel(value: string): string {
  return GENDER_OPTIONS.find((g) => g.value === value)?.label ?? value;
}
