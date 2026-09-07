import { prisma } from "@/lib/ai-chat/db";
import {
  BUDGET_OPTIONS,
  CLIMATE_OPTIONS,
  HONESTY_OPTIONS,
  KIDS_OPTIONS,
  WEEK_IS_OPTIONS,
  WEEKEND_OPTIONS,
  ageYearsFromBirthDate,
  styleEraLabel,
  whyHereLabel,
} from "@/lib/onboarding/form-options";
import { selectedOutfitLookLabels } from "@/lib/onboarding/outfit-style-catalog";
import { parseStylePhotoAnalysis } from "./result";
import {
  parseStyleUserReview,
  type ConfirmedBody,
  type StyleUserReview,
} from "./review";
import { findByHash } from "./store";

export type VerdictMissing = { field: string; reason: string };

export function verdictReadiness(opts: {
  analysisUsable: boolean;
  reviewSubmitted: boolean;
  genderPresentation: string | null | undefined;
}): VerdictMissing[] {
  const missing: VerdictMissing[] = [];
  if (!opts.genderPresentation?.trim()) {
    missing.push({
      field: "gender_presentation",
      reason: "How you dress is still missing.",
    });
  }
  return missing;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (isRecord(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

function pickStr(obj: unknown, ...keys: string[]): string | null {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNum(obj: unknown, ...keys: string[]): number | null {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickStrs(obj: unknown, ...keys: string[]): string[] {
  if (!isRecord(obj)) return [];
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
    }
  }
  return [];
}

function labelOf(
  options: readonly { value: string; label: string }[],
  raw: string | null,
): string | null {
  if (!raw) return null;
  return options.find((o) => o.value === raw)?.label ?? raw;
}

function csvLabels(
  options: readonly { value: string; label: string }[],
  raw: string | null,
): string | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.map((p) => labelOf(options, p) ?? p).join(", ");
}

function ageYears(profile: unknown): number | null {
  const birth =
    pickStr(profile, "birthDate", "birthDate") ??
    (isRecord(profile) && profile.birthDate instanceof Date
      ? profile.birthDate.toISOString()
      : isRecord(profile) && profile.birthDate instanceof Date
        ? profile.birthDate.toISOString()
        : null);
  if (!birth) return null;
  return ageYearsFromBirthDate(birth);
}

export function buildVerdictPayload(input: {
  profile: unknown;
  sizing: unknown;
  brands: unknown[];
  hardNegatives: unknown[];
  tasteTags: unknown[];
  confirmedBody?: ConfirmedBody | null;
}): {
  questionnaireAnswers: Record<string, unknown>;
  measurements: Record<string, unknown>;
  wardrobeInventory: Record<string, unknown>;
  applicationContext: Record<string, unknown>;
} {
  const { profile, sizing, confirmedBody } = input;
  const weekIs = pickStr(profile, "weekIs", "weekIs");
  const weekendsAre = pickStr(profile, "weekendsAre", "weekendsAre");
  const dressingFor = pickStr(profile, "dressingFor", "dressingFor");
  const styleEra = pickStr(profile, "styleEra", "styleEra");
  const climate = pickStr(profile, "climate");
  const budget = pickStr(profile, "valuePhilosophy", "valuePhilosophy");
  const honesty = pickStr(profile, "honestyPreference", "honestyPreference");
  const styleFriction = pickStr(profile, "styleFriction", "styleFriction");
  const styleBecome = pickStr(profile, "styleBecome", "styleBecome");
  const heightCm =
    confirmedBody?.height_cm ?? pickNum(sizing, "heightCm", "heightCm");
  const weightKg =
    confirmedBody?.weight_kg ?? pickNum(sizing, "weightKg", "weightKg");
  const bodyType =
    confirmedBody?.body_type ?? pickStr(sizing, "bodyType", "bodyType");

  const likes: string[] = [];
  const brandAvoids: string[] = [];
  const brandNotes: Record<string, unknown>[] = [];
  for (const b of input.brands) {
    const brand = pickStr(b, "brand");
    if (!brand) continue;
    const sentiment = pickStr(b, "sentiment", "sentiment")?.toLowerCase();
    const reasons = pickStrs(b, "reasons");
    brandNotes.push(compact({ brand, sentiment, reasons }));
    if (sentiment === "like" || sentiment === "love") likes.push(brand);
    if (sentiment === "avoid" || sentiment === "hate") brandAvoids.push(brand);
  }

  const styleVetoes: Record<string, unknown>[] = [];
  const comfort: Record<string, unknown>[] = [];
  for (const h of input.hardNegatives) {
    const value = pickStr(h, "value");
    if (!value) continue;
    const note = pickStr(h, "note");
    const reason = pickStr(h, "reason");
    const entry = compact({ value, note, reason });
    const noteKey = note?.toLowerCase();
    const scope = pickStr(h, "scope")?.toLowerCase();
    if (noteKey === "comfort" || scope === "fit") comfort.push(entry);
    else styleVetoes.push(entry);
  }

  const worn: string[] = [];
  const wanted: string[] = [];
  const complimentTags: string[] = [];
  const comfortTags: string[] = [];
  for (const t of input.tasteTags) {
    const tag = pickStr(t, "tag");
    if (!tag) continue;
    const category = pickStr(t, "category")?.toLowerCase();
    if (category === "worn") worn.push(tag);
    else if (category === "aspirational") wanted.push(tag);
    else if (category === "compliment") complimentTags.push(tag);
    else if (category === "comfort") comfortTags.push(tag);
  }
  const wornLooks = selectedOutfitLookLabels(worn);
  const wantedLooks = selectedOutfitLookLabels(wanted);

  const styleMix =
    isRecord(profile) && (profile.styleMix != null || profile.styleMix != null)
      ? (profile.styleMix ?? profile.styleMix)
      : null;

  const questionnaireAnswers = compact({
    identity: compact({
      preferred_name: pickStr(profile, "preferredName", "preferredName"),
      gender_presentation: pickStr(profile, "genderPresentation", "genderPresentation"),
      age_years: ageYears(profile),
      age_range: pickStr(profile, "ageRange", "ageRange"),
      style_era: styleEra,
      style_era_label: styleEra ? styleEraLabel(styleEra) : null,
    }),
    goal: dressingFor,
    goal_label: whyHereLabel(dressingFor),
    lifestyle: compact({
      week_is: weekIs,
      week_is_label: csvLabels(WEEK_IS_OPTIONS, weekIs),
      weekends_are: weekendsAre,
      weekends_are_label: csvLabels(WEEKEND_OPTIONS, weekendsAre),
      kids: pickStr(profile, "kids"),
      kids_label: csvLabels(KIDS_OPTIONS, pickStr(profile, "kids")),
      occupation: pickStr(profile, "occupation", "occupation"),
      work_environment: pickStr(profile, "workEnvironment", "workEnvironment"),
      lifestyle_tags: pickStrs(profile, "lifestyleTags", "lifestyleTags"),
    }),
    climate,
    climate_label: csvLabels(CLIMATE_OPTIONS, climate),
    location: compact({
      city: pickStr(profile, "city"),
      country: pickStr(profile, "shippingCountry", "country"),
    }),
    budget: compact({
      currency: pickStr(profile, "currency"),
      philosophy: budget,
      philosophy_label: csvLabels(BUDGET_OPTIONS, budget),
    }),
    taste: compact({
      style_era: styleEra,
      style_era_label: styleEra ? styleEraLabel(styleEra) : null,
      honesty,
      honesty_label: labelOf(HONESTY_OPTIONS, honesty),
      honest_corner: compact({
        friction: styleFriction,
        become: styleBecome,
      }),
      compliments: [
        ...pickStrs(profile, "complimentPreferences", "complimentPreferences"),
        ...complimentTags,
      ],
      style_mix: styleMix,
    }),
  });

  const measurements = compact({
    body: compact({
      height_cm: heightCm,
      weight_kg: weightKg,
      body_type: bodyType,
      muscularity: confirmedBody?.muscularity ?? null,
      body_shape: confirmedBody?.body_shape ?? null,
      bust_fullness: confirmedBody?.bust_fullness ?? null,
      leg_line: confirmedBody?.leg_line ?? null,
      shoulder_width: pickStr(sizing, "shoulderWidth", "shoulderWidth"),
      neck: pickStr(sizing, "neckSize", "neckSize"),
      sleeve: pickStr(sizing, "sleeveLength", "sleeveLength"),
      top_usual_size: pickStr(sizing, "topUsualSize", "topUsualSize"),
      bottom_waist: pickStr(sizing, "bottomWaist", "bottomWaist"),
      bottom_inseam: pickStr(sizing, "bottomInseam", "bottomInseam"),
      bottom_rise: pickStr(sizing, "bottomRise", "bottomRise"),
      shoe_eu: pickNum(sizing, "shoeEU", "shoeEU"),
      shoe_width: pickStr(sizing, "shoeWidth", "shoeWidth"),
    }),
    preferred_fit: compact({
      top: pickStr(sizing, "topPreferredFit", "topPreferredFit"),
      bottom: pickStr(sizing, "bottomPreferredFit", "bottomPreferredFit"),
    }),
    sensitivities: pickStrs(sizing, "sensitivities"),
    known_good_garments: [],
    confirmation_source: confirmedBody ? "user_scan_review" : "sizing_profile",
  });

  const wardrobeInventory = compact({
    worn: wornLooks,
    wanted: wantedLooks,
    honest_corner: compact({
      friction: styleFriction,
      become: styleBecome,
    }),
    brands_like: likes,
    brands_avoid: [
      ...brandAvoids,
      ...styleVetoes.flatMap((v) =>
        typeof v.value === "string" && v.value ? [v.value] : [],
      ),
    ],
    brands: brandNotes,
    style_vetoes: styleVetoes,
    comfort: [
      ...comfort,
      ...comfortTags.map((value) => compact({ value })),
    ],
    style_mix: styleMix,
  });

  const lengthUnit = pickStr(profile, "unitsLength", "unitsLength");
  const shoeUnit = pickStr(profile, "unitsShoe", "unitsShoe");
  const systems = [lengthUnit, shoeUnit].filter((v): v is string => Boolean(v));

  const applicationContext = compact({
    market: pickStr(profile, "shippingCountry", "country"),
    city: pickStr(profile, "city"),
    preferred_size_systems: systems.length ? systems : ["EU", "international"],
    honesty,
  });

  return {
    questionnaireAnswers,
    measurements,
    wardrobeInventory,
    applicationContext,
  };
}

export async function assembleVerdictInput(
  userId: string,
  photoHash: string,
  extraBody?: ConfirmedBody | null,
) {
  const [row, profile, sizing, brands, hardNegatives, tasteTags] =
    await Promise.all([
      findByHash(userId, photoHash),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.sizingProfile.findUnique({ where: { userId } }),
      prisma.brandPreference.findMany({ where: { userId } }),
      prisma.hardNegative.findMany({ where: { userId } }),
      prisma.tasteTag.findMany({ where: { userId } }),
    ]);

  const analysis = parseStylePhotoAnalysis(row?.result);
  const review = parseStyleUserReview(row?.userReview);
  const confirmedBody = extraBody
    ? {
        height_cm:
          extraBody.height_cm ?? review?.confirmed_body?.height_cm ?? null,
        weight_kg:
          extraBody.weight_kg ?? review?.confirmed_body?.weight_kg ?? null,
        body_type:
          extraBody.body_type ?? review?.confirmed_body?.body_type ?? null,
        muscularity:
          extraBody.muscularity ?? review?.confirmed_body?.muscularity ?? null,
        body_shape:
          extraBody.body_shape ?? review?.confirmed_body?.body_shape ?? null,
        bust_fullness:
          extraBody.bust_fullness ??
          review?.confirmed_body?.bust_fullness ??
          null,
        leg_line:
          extraBody.leg_line ?? review?.confirmed_body?.leg_line ?? null,
      }
    : review?.confirmed_body;

  const missing = verdictReadiness({
    analysisUsable: analysis?.analysis_status.usable === true,
    reviewSubmitted: review != null,
    genderPresentation: pickStr(profile, "genderPresentation", "genderPresentation"),
  });

  const payload = buildVerdictPayload({
    profile,
    sizing,
    brands,
    hardNegatives,
    tasteTags,
    confirmedBody,
  });

  return {
    row,
    analysis,
    review,
    missing,
    ...payload,
  };
}

export function mergeConfirmedBody(
  review: StyleUserReview | null,
  extra: ConfirmedBody | null | undefined,
): StyleUserReview | null {
  if (!review) return review;
  if (!extra) return review;
  return { ...review, confirmed_body: extra };
}
