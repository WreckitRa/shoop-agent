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

/** What her week is — picks the daily + second occasion. */
export const WEEK_IS_OPTIONS = [
  { value: "studying", label: "Studying" },
  { value: "working_onsite", label: "Working on-site" },
  { value: "working_home", label: "Working from home" },
  { value: "working_mixed", label: "Mix of home and office" },
  { value: "own_thing", label: "Doing my own thing" },
  { value: "home_with_kids", label: "Home with kids" },
  { value: "between_things", label: "Between things" },
  { value: "retired", label: "Retired" },
] as const;

/** Relationship context — picks the night occasion. */
export const DRESSING_FOR_OPTIONS = [
  { value: "dating", label: "Dating" },
  { value: "with_someone", label: "With someone" },
  { value: "not_right_now", label: "Not right now" },
] as const;

export const KIDS_OPTIONS = [
  { value: "young", label: "Young kids" },
  { value: "older", label: "Older kids" },
  { value: "none", label: "No kids" },
] as const;

export const CLIMATE_OPTIONS = [
  { value: "hot_humid", label: "Hot and humid" },
  { value: "hot_dry", label: "Hot and dry" },
  { value: "four_seasons", label: "Four seasons" },
  { value: "mild_wet", label: "Mild and wet" },
  { value: "cold", label: "Cold" },
] as const;

/** Hard predicates that filter items. Never scores. */
export const COMFORT_OPTIONS = [
  { value: "no heels", label: "No heels" },
  { value: "nothing sleeveless", label: "Nothing sleeveless" },
  { value: "nothing short", label: "Nothing short" },
  { value: "no tight fits", label: "No tight fits" },
  { value: "covered shoulders", label: "Covered shoulders" },
  { value: "nothing sheer", label: "Nothing sheer" },
  { value: "no low rise", label: "No low rise" },
] as const;

export type ClimateValue = (typeof CLIMATE_OPTIONS)[number]["value"];

const CLIMATE_VALUES = new Set<string>(CLIMATE_OPTIONS.map((o) => o.value));
const COMFORT_VALUES = new Set<string>(COMFORT_OPTIONS.map((o) => o.value));

const CLIMATE_ALIASES: Record<string, ClimateValue> = {
  "hot humid": "hot_humid",
  "hot and humid": "hot_humid",
  humid: "hot_humid",
  "hot dry": "hot_dry",
  "hot and dry": "hot_dry",
  "four seasons": "four_seasons",
  "mild wet": "mild_wet",
  "mild and wet": "mild_wet",
  "cold": "cold",
};

/** Map the three life answers onto existing lifestyleTags so the outfit grid keeps working. */
export function lifestyleTagsFromLife(input: {
  weekIs?: string | null;
  kids?: string | null;
}): string[] {
  const tags = new Set<string>();
  switch (input.weekIs) {
    case "studying":
      tags.add("campus_life");
      break;
    case "working_onsite":
    case "working_home":
    case "working_mixed":
      tags.add("deep_in_career");
      break;
    case "own_thing":
      tags.add("running_the_show");
      break;
    case "home_with_kids":
      tags.add("kids_in_the_mix");
      break;
    case "retired":
      tags.add("time_is_mine");
      break;
    default:
      break;
  }
  if (input.kids === "young" || input.kids === "older") {
    tags.add("kids_in_the_mix");
  }
  return [...tags];
}

export function normalizeClimate(
  raw: string | null | undefined,
): ClimateValue | "" {
  if (!raw?.trim()) return "";
  const t = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (CLIMATE_VALUES.has(t)) return t as ClimateValue;
  const spaced = raw.trim().toLowerCase();
  return CLIMATE_ALIASES[spaced] ?? "";
}

export function isComfortConstraint(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  return COMFORT_VALUES.has(raw.trim().toLowerCase());
}

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

export function parseCsvValues(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function joinCsvValues(values: readonly string[]): string {
  return values.map((v) => v.trim()).filter(Boolean).join(",");
}

export function styleEraToAgeRange(era: string | null | undefined): string {
  if (!era?.trim()) return "";
  for (const part of parseCsvValues(era)) {
    const match = STYLE_ERAS.find((e) => e.value === part);
    if (match) return match.ageRange;
  }
  return "";
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

/**
 * Slightly narrow / recenter era chips around the user's age.
 * No DOB → full list. With DOB → a short window around their era.
 */
export function styleErasForAge(
  ageYears: number | null,
): readonly (typeof STYLE_ERAS)[number][] {
  if (ageYears == null) return STYLE_ERAS;
  const primary = styleEraFromAge(ageYears);
  const primaryIdx = STYLE_ERAS.findIndex((e) => e.value === primary);
  if (primaryIdx < 0) return STYLE_ERAS;

  let start = Math.max(0, primaryIdx - 1);
  let end = Math.min(STYLE_ERAS.length, primaryIdx + 3);
  while (end - start < 4 && (start > 0 || end < STYLE_ERAS.length)) {
    if (start > 0) start -= 1;
    else end += 1;
  }
  while (end - start < 5 && end < STYLE_ERAS.length) end += 1;
  while (end - start < 5 && start > 0) start -= 1;
  return STYLE_ERAS.slice(start, end);
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

/** Latest YYYY-MM-DD allowed so the person is at least `minAge` years old. */
export function maxBirthDateIso(minAge = 13): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - minAge);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isAtLeastAge(
  isoOrDate: string | Date,
  minAge = 13,
): boolean {
  const age = ageYearsFromBirthDate(isoOrDate);
  return age != null && age >= minAge;
}

export function styleEraLabel(value: string): string {
  const parts = parseCsvValues(value);
  if (parts.length <= 1) {
    const single = parts[0] ?? value;
    return STYLE_ERAS.find((e) => e.value === single)?.label ?? single;
  }
  return parts
    .map((p) => STYLE_ERAS.find((e) => e.value === p)?.label ?? p)
    .join(", ");
}

export const DEFAULT_SHIPPING_COUNTRY = "United States";
export const DEFAULT_CITY = "New York";
export const DEFAULT_CURRENCY = "USD";
