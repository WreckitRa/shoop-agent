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
  { value: "deal_hunter", label: "Deal hunter", hint: "Sales and value drive me" },
  { value: "design_first", label: "Design-led", hint: "Aesthetics over price" },
] as const;

export const STYLE_ERAS = [
  { value: "13_14", label: "13–14 · Figuring it out", ageRange: "13-17" },
  { value: "15_17", label: "15–17 · High-school era", ageRange: "13-17" },
  { value: "18_22", label: "18–22 · Campus era", ageRange: "18-24" },
  { value: "23_29", label: "23–29 · First-paycheck era", ageRange: "25-34" },
  { value: "30s", label: "30s · Prime era", ageRange: "25-34" },
  { value: "40s", label: "40s · Power era", ageRange: "35-44" },
  { value: "50s_60s", label: "50s–60s · Refined era", ageRange: "55-64" },
  { value: "65_plus", label: "65+ · Icon era", ageRange: "65+" },
] as const;

export type StyleEraValue = (typeof STYLE_ERAS)[number]["value"];

export const WORLD_OPTIONS = [
  { value: "campus_life", label: "Campus life" },
  { value: "deep_in_career", label: "Deep in my career" },
  { value: "first_job", label: "First-job era" },
  { value: "running_the_show", label: "Running the show" },
  { value: "kids_in_the_mix", label: "Kids in the mix" },
  { value: "time_is_mine", label: "My time is mine again" },
] as const;

export const COMPLIMENT_OPTIONS = [
  "Effortless",
  "Polished",
  "Bold",
  "Expensive",
  "Unique",
  "Classy",
  "Put-together",
  "Cool",
] as const;

export const HONESTY_OPTIONS = [
  {
    value: "gentle",
    label: "Gentle",
    quote: "Nudge me kindly. Wrap the truth in something soft.",
  },
  {
    value: "straight",
    label: "Straight with me",
    quote:
      "Talk to me like a good friend. If it doesn't work on me, say so... and show me what does.",
  },
  {
    value: "no_mercy",
    label: "No mercy",
    quote:
      "Full stylist mode. Tell me exactly what works, what doesn't, and why. I can take it.",
  },
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

/** Clothing-tag style: "US - 10, EU - 43, UK - 9" */
export function formatRegionSizeLabel(
  parts: Array<{ region: string; size: string | number }>,
): string {
  return parts.map((p) => `${p.region} - ${p.size}`).join(", ");
}

/** Mens-leaning EU ↔ US ↔ UK shoe chart (adult). */
const SHOE_EU_TO_US_UK: Record<number, { us: number; uk: number }> = {
  35: { us: 3.5, uk: 3 },
  36: { us: 4.5, uk: 4 },
  37: { us: 5, uk: 4.5 },
  38: { us: 6, uk: 5.5 },
  39: { us: 6.5, uk: 6 },
  40: { us: 7.5, uk: 7 },
  41: { us: 8.5, uk: 8 },
  42: { us: 9, uk: 8.5 },
  43: { us: 10, uk: 9 },
  44: { us: 11, uk: 10 },
  45: { us: 12, uk: 11 },
  46: { us: 12.5, uk: 11.5 },
  47: { us: 13, uk: 12 },
  48: { us: 14, uk: 13 },
  49: { us: 15, uk: 14 },
  50: { us: 15.5, uk: 14.5 },
  51: { us: 16, uk: 15 },
  52: { us: 16.5, uk: 15.5 },
  53: { us: 17, uk: 16 },
  54: { us: 17.5, uk: 16.5 },
};

/** Alpha top → EU / IT / FR (mens-leaning). */
const TOP_ALPHA_REGIONS: Record<
  string,
  { eu: number; it: number; fr: number }
> = {
  XXS: { eu: 42, it: 42, fr: 34 },
  XS: { eu: 44, it: 44, fr: 36 },
  S: { eu: 46, it: 46, fr: 38 },
  M: { eu: 50, it: 50, fr: 40 },
  L: { eu: 52, it: 52, fr: 42 },
  XL: { eu: 54, it: 54, fr: 44 },
  XXL: { eu: 56, it: 56, fr: 46 },
  "3XL": { eu: 58, it: 58, fr: 48 },
};

/** FR/EU numeric top → US alpha. */
const TOP_NUMERIC_TO_US: Record<string, string> = {
  "32": "XXS",
  "34": "XS",
  "36": "S",
  "38": "S",
  "40": "M",
  "42": "L",
  "44": "XL",
  "46": "XXL",
};

function formatShoeNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

export function formatShoeSizeLabel(euRaw: string): string {
  const eu = Number(euRaw);
  const mapped = SHOE_EU_TO_US_UK[eu];
  if (!mapped) {
    return formatRegionSizeLabel([{ region: "EU", size: euRaw }]);
  }
  return formatRegionSizeLabel([
    { region: "US", size: formatShoeNumber(mapped.us) },
    { region: "EU", size: eu },
    { region: "UK", size: formatShoeNumber(mapped.uk) },
  ]);
}

export function formatTopSizeLabel(size: string): string {
  const alpha = TOP_ALPHA_REGIONS[size.toUpperCase()];
  if (alpha) {
    return formatRegionSizeLabel([
      { region: "US", size: size.toUpperCase() },
      { region: "EU", size: alpha.eu },
      { region: "FR", size: alpha.fr },
    ]);
  }
  const us = TOP_NUMERIC_TO_US[size];
  if (us) {
    return formatRegionSizeLabel([
      { region: "US", size: us },
      { region: "EU", size },
      { region: "FR", size },
    ]);
  }
  return formatRegionSizeLabel([{ region: "US", size }]);
}

function parseBottomWaist(size: string): number | null {
  const wx = size.match(/^(\d{2})x\d{2}$/i);
  if (wx) return Number(wx[1]);
  if (/^\d{2}$/.test(size)) return Number(size);
  return null;
}

/** US waist → EU / MX dress-pant style equivalents. */
function bottomRegionsFromUsWaist(usWaist: number): {
  eu: number;
  mx: number;
} {
  return {
    eu: usWaist + 16,
    mx: usWaist + 8,
  };
}

export function formatBottomSizeLabel(size: string): string {
  const waist = parseBottomWaist(size);
  if (waist == null) {
    return formatRegionSizeLabel([{ region: "US", size }]);
  }
  const { eu, mx } = bottomRegionsFromUsWaist(waist);
  const usDisplay = size.includes("x") || size.includes("X")
    ? size.replace(/x/i, "×")
    : String(waist);
  return formatRegionSizeLabel([
    { region: "US", size: usDisplay },
    { region: "EU", size: eu },
    { region: "MX", size: mx },
  ]);
}

export const TOP_SIZE_OPTIONS = TOP_SIZES.map((value) => ({
  value,
  label: formatTopSizeLabel(value),
}));

export const BOTTOM_SIZE_OPTIONS = BOTTOM_SIZES.map((value) => ({
  value,
  label: formatBottomSizeLabel(value),
}));

export const SHOE_SIZE_OPTIONS = SHOE_EU_SIZES.map((value) => ({
  value,
  label: formatShoeSizeLabel(value),
}));

export const STYLE_SUGGESTIONS = [
  "minimal", "classic", "streetwear", "old money", "gorpcore", "preppy",
  "bohemian", "sporty", "tailored", "casual", "avant-garde", "vintage",
  "neutral tones", "bold colors", "quiet luxury",
] as const;

export const BRAND_SUGGESTIONS = [
  "Zara", "COS", "Aritzia", "Reformation", "Sézane", "Uniqlo", "Everlane",
  "Arket", "Nike", "Adidas", "Lululemon", "Levi's", "Patagonia", "New Balance",
  "Gucci", "Prada", "Loro Piana",
] as const;

export const HARD_AVOID_SUGGESTIONS = [
  "loud logos", "chunky", "neon", "distressed",
  "leather", "wool", "nickel", "fur", "fast fashion", "synthetic fragrances",
  "animal products", "logo-heavy", "dry clean only",
] as const;

export const STYLE_VETO_SUGGESTIONS = [
  "loud logos", "chunky", "neon", "distressed",
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

export function styleEraToAgeRange(era: string | null | undefined): string {
  if (!era?.trim()) return "";
  const match = STYLE_ERAS.find((e) => e.value === era.trim());
  return match?.ageRange ?? "";
}

/** Guess a style era from age in years (birthday → chip). */
export function styleEraFromAge(ageYears: number): StyleEraValue {
  if (ageYears <= 14) return "13_14";
  if (ageYears <= 17) return "15_17";
  if (ageYears <= 22) return "18_22";
  if (ageYears <= 29) return "23_29";
  if (ageYears <= 39) return "30s";
  if (ageYears <= 49) return "40s";
  if (ageYears <= 64) return "50s_60s";
  return "65_plus";
}

export function ageYearsFromBirthDate(isoOrDate: string | Date): number | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function genderLabel(value: string): string {
  return GENDER_OPTIONS.find((g) => g.value === value)?.label ?? value;
}

export function styleEraLabel(value: string): string {
  return STYLE_ERAS.find((e) => e.value === value)?.label ?? value;
}
