/**
 * LLM parser for the Fitting Mirror free-text box.
 * Turns casual utterances into structured onboarding patch fields.
 */

import { z } from "zod";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "@/lib/ai-chat/constants";
import type { LightweightPromptAudit } from "@/lib/ai-chat/prompt-run/lightweight-audit";
import {
  parseLlmJsonObject,
  stripNullFields,
} from "@/lib/ai-chat/llm-json";
import type { onboardingPatchSchema } from "@/lib/onboarding/status";
import {
  AGE_RANGES,
  BUDGET_OPTIONS,
  GENDER_OPTIONS,
  HONESTY_OPTIONS,
  STYLE_ERAS,
  joinCsvValues,
  normalizeAgeRange,
  normalizeGender,
  styleEraFromAge,
  styleEraToAgeRange,
} from "@/lib/onboarding/form-options";
import { tagsFromFreeText } from "@/lib/onboarding/taste-tags";

export type FittingTellStep =
  | "name"
  | "spend"
  | "photo"
  | "worn"
  | "wanted"
  | "nolist"
  | "honesty"
  | "verdict";

export type FittingTellKnown = {
  preferredName?: string;
  genderPresentation?: string;
  styleEras?: string[];
  budgetPhilosophies?: string[];
  brandLikes?: string[];
  brandAvoids?: string[];
  hardAvoids?: string[];
  honestyPreference?: string;
  heightCm?: number | null;
  weightKg?: number | null;
  build?: string | null;
  /** Step the user is on in The Fitting. */
  currentStep?: FittingTellStep;
};

/** Where each extracted fact surfaces in the left-side flow. */
export type FittingTellBucket =
  | "name"
  | "spend"
  | "photo"
  | "nolist"
  | "honesty"
  | "taste";

const genderEnum = z.enum(
  GENDER_OPTIONS.map((g) => g.value) as [string, ...string[]],
);
const budgetEnum = z.enum(
  BUDGET_OPTIONS.map((b) => b.value) as [string, ...string[]],
);
const eraEnum = z.enum(
  STYLE_ERAS.map((e) => e.value) as [string, ...string[]],
);
const honestyEnum = z.enum(
  HONESTY_OPTIONS.map((h) => h.value) as [string, ...string[]],
);
const ageEnum = z.enum(AGE_RANGES as unknown as [string, ...string[]]);
const buildEnum = z.enum(["slim", "average", "athletic", "broad", "plus"]);
const muscleEnum = z.enum(["low", "moderate", "high"]);
const shapeEnum = z.enum([
  "rectangle",
  "triangle",
  "inverted_triangle",
  "hourglass",
  "oval",
]);
const bustEnum = z.enum(["subtle", "average", "full", "very_full"]);

const intish = (min: number, max: number) =>
  z.preprocess((v) => {
    if (v == null || v === "") return undefined;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? Math.round(n) : undefined;
    }
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
    return v;
  }, z.number().int().min(min).max(max).optional());

function asStringArray(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
      .filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) {
    return v
      .split(/[,;/|]/)
      .map((s) => s.replace(/^[-–•\s]+/, "").trim())
      .filter(Boolean);
  }
  return undefined;
}

/** Fill gaps when the model misses obvious surface facts in the utterance. */
export function backfillFittingTellFromText(
  text: string,
  extraction: FittingTellExtraction,
): FittingTellExtraction {
  const t = text.trim();
  const out: FittingTellExtraction = { ...extraction };

  if (!out.preferredName) {
    const m =
      t.match(
        /\b(?:call me|i'm|i am|my name is|this is)\s+([A-Za-z][A-Za-z'’\-]{1,40})\b/i,
      ) ?? t.match(/^([A-Za-z][A-Za-z'’\-]{1,40})\s*[,.!]?\s*$/);
    if (m?.[1] && !/^(about|pretty|super|just|also|really)$/i.test(m[1])) {
      out.preferredName = m[1];
    }
  }

  if (!out.styleEras?.length) {
    if (/\b(early\s*)?thirt(y|ies)|30s?\b/i.test(t)) out.styleEras = ["30s"];
    else if (/\b(early\s*)?fort(y|ies)|40s?\b/i.test(t)) out.styleEras = ["40s"];
    else if (/\bearly\s*twent/i.test(t) || /\bcampus\b/i.test(t))
      out.styleEras = ["18_22"];
    else if (/\blate\s*twent|first.?paycheck/i.test(t))
      out.styleEras = ["23_29"];
  }

  if (!out.genderPresentation) {
    if (/\b(dress|present|shop)\s*(as\s*)?masculine\b|\bmasculine\b/i.test(t))
      out.genderPresentation = "masculine";
    else if (/\bfeminine\b|\bwomen'?s\b/i.test(t))
      out.genderPresentation = "feminine";
  }

  if (out.weightKg == null) {
    const kg = t.match(/\b(\d{2,3})\s*kg\b/i);
    if (kg) out.weightKg = Number(kg[1]);
    const lb = t.match(/\b(\d{2,3})\s*(?:lb|lbs|pounds?)\b/i);
    if (lb && out.weightKg == null) {
      out.weightKg = Math.round(Number(lb[1]) * 0.453592);
    }
  }

  if (out.honestyPreference == null) {
    if (/\bno[-\s]?mercy|don'?t sugarcoat|brutal|harsh\b/i.test(t))
      out.honestyPreference = "no_mercy";
    else if (/\bgentle|soft nudge/i.test(t)) out.honestyPreference = "gentle";
    else if (/\bstraight with me|be (straight|direct|honest)\b/i.test(t))
      out.honestyPreference = "straight";
  }

  if (
    !out.budgetPhilosophies?.length &&
    /\bdeal hunter|smart value|budget/i.test(t)
  ) {
    out.budgetPhilosophies = /\bdeal hunter\b/i.test(t)
      ? ["deal_hunter"]
      : ["best_value"];
  }

  if (!out.hardAvoids?.length) {
    const hard: string[] = [];
    if (/\bneon\b/i.test(t)) hard.push("neon");
    if (/\bdistress/i.test(t)) hard.push("distressed denim");
    if (/\bsee[-\s]?through\b/i.test(t)) hard.push("see-through fabrics");
    if (/\blogos?\b/i.test(t) && /\b(no|never|hate|avoid)\b/i.test(t))
      hard.push("logos");
    if (hard.length) out.hardAvoids = hard;
  }

  return out;
}

/** Soft-normalize raw LLM JSON before Zod so one bad field doesn't drop the rest. */
export function normalizeFittingTellRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (typeof o.preferredName === "string") {
    o.preferredName = o.preferredName.replace(/^["']|["']$/g, "").trim();
    if (!o.preferredName) delete o.preferredName;
  }

  if (typeof o.genderPresentation === "string") {
    const g = normalizeGender(o.genderPresentation);
    if ((GENDER_OPTIONS as readonly { value: string }[]).some((x) => x.value === g)) {
      o.genderPresentation = g;
    } else {
      delete o.genderPresentation;
    }
  }

  if (typeof o.honestyPreference === "string") {
    const h = o.honestyPreference.trim().toLowerCase().replace(/\s+/g, "_");
    if (h.includes("mercy") || h.includes("brutal") || h.includes("harsh")) {
      o.honestyPreference = "no_mercy";
    } else if (h.includes("gentle") || h.includes("soft") || h.includes("kind")) {
      o.honestyPreference = "gentle";
    } else if (h.includes("straight") || h.includes("honest") || h.includes("direct")) {
      o.honestyPreference = "straight";
    } else if (!(HONESTY_OPTIONS as readonly { value: string }[]).some((x) => x.value === h)) {
      delete o.honestyPreference;
    } else {
      o.honestyPreference = h;
    }
  }

  if (Array.isArray(o.styleEras) || typeof o.styleEras === "string") {
    const eras = asStringArray(o.styleEras) ?? [];
    const allowed = new Set<string>(STYLE_ERAS.map((e) => e.value));
    const mapped = eras
      .map((e) => {
        const t = e.trim().toLowerCase().replace(/\s+/g, "_");
        if (allowed.has(t)) return t;
        if (/30|thirt/.test(t)) return "30s";
        if (/40|fort/.test(t)) return "40s";
        if (/early.?twent|20s|campus/.test(t)) return "18_22";
        if (/late.?twent|first.?pay/.test(t)) return "23_29";
        if (/teen|high.?school|15|16|17/.test(t)) return "15_17";
        if (/50|60|refin/.test(t)) return "50s_60s";
        if (/65|icon/.test(t)) return "65_plus";
        return t;
      })
      .filter((e) => allowed.has(e));
    if (mapped.length) o.styleEras = mapped;
    else delete o.styleEras;
  }

  if (Array.isArray(o.budgetPhilosophies) || typeof o.budgetPhilosophies === "string") {
    const budgets = asStringArray(o.budgetPhilosophies) ?? [];
    const allowed = new Set<string>(BUDGET_OPTIONS.map((b) => b.value));
    const mapped = budgets
      .map((b) => {
        const t = b.trim().toLowerCase().replace(/\s+/g, "_");
        if (allowed.has(t)) return t;
        if (/lux|designer/.test(t)) return "luxury";
        if (/deal|sale|cheap/.test(t)) return "deal_hunter";
        if (/premium|quality/.test(t)) return "premium";
        if (/design|aesthetic/.test(t)) return "design_first";
        if (/value|smart|budget/.test(t)) return "best_value";
        return t;
      })
      .filter((b) => allowed.has(b));
    if (mapped.length) o.budgetPhilosophies = mapped;
    else delete o.budgetPhilosophies;
  }

  for (const key of [
    "brandLikes",
    "brandAvoids",
    "hardAvoids",
    "styleLikes",
    "styleAvoids",
  ] as const) {
    const arr = asStringArray(o[key]);
    if (arr?.length) o[key] = arr.slice(0, 16);
    else delete o[key];
  }

  if (typeof o.build === "string") {
    const b = o.build.trim().toLowerCase();
    if (b.includes("ath") || b.includes("muscular") || b.includes("fit"))
      o.build = "athletic";
    else if (b.includes("slim") || b.includes("thin") || b.includes("lean"))
      o.build = "slim";
    else if (b.includes("broad") || b.includes("stock")) o.build = "broad";
    else if (b.includes("plus") || b.includes("curvy") || b.includes("large"))
      o.build = "plus";
    else if (b.includes("avg") || b.includes("average") || b.includes("medium"))
      o.build = "average";
  }

  if (typeof o.muscularity === "string") {
    const m = o.muscularity.trim().toLowerCase();
    if (/high|defined|ripped|muscular|strong/.test(m)) o.muscularity = "high";
    else if (/low|soft|none|untoned/.test(m)) o.muscularity = "low";
    else if (/mod|tone|light|decent|some/.test(m)) o.muscularity = "moderate";
  }

  if (typeof o.bodyShape === "string") {
    const s = o.bodyShape.trim().toLowerCase().replace(/\s+/g, "_");
    if (s.includes("hour")) o.bodyShape = "hourglass";
    else if (s.includes("invert")) o.bodyShape = "inverted_triangle";
    else if (s.includes("triangle") || s.includes("pear")) o.bodyShape = "triangle";
    else if (s.includes("rect") || s.includes("straight")) o.bodyShape = "rectangle";
    else if (s.includes("oval") || s.includes("apple")) o.bodyShape = "oval";
  }

  if (typeof o.summary === "string") {
    o.summary = o.summary.trim().slice(0, 280);
  }
  if (!o.summary) o.summary = "Noted — keep going.";

  return o;
}

export const fittingTellExtractionSchema = z
  .object({
    preferredName: z.string().min(1).max(80).optional(),
    genderPresentation: genderEnum.optional(),
    styleEras: z.array(eraEnum).max(4).optional(),
    ageRange: ageEnum.optional(),
    ageYears: intish(13, 100),
    budgetPhilosophies: z.array(budgetEnum).max(4).optional(),
    heightCm: intish(120, 230),
    /** Imperial breakdown — converted when heightCm missing. */
    heightFt: intish(4, 7),
    heightIn: intish(0, 11),
    weightKg: intish(35, 250),
    build: buildEnum.optional(),
    muscularity: muscleEnum.optional(),
    bodyShape: shapeEnum.optional(),
    bustFullness: bustEnum.optional(),
    brandLikes: z.array(z.string().min(1).max(60)).max(12).optional(),
    brandAvoids: z.array(z.string().min(1).max(60)).max(12).optional(),
    hardAvoids: z.array(z.string().min(1).max(80)).max(16).optional(),
    styleLikes: z.array(z.string().min(1).max(60)).max(16).optional(),
    styleAvoids: z.array(z.string().min(1).max(60)).max(16).optional(),
    honestyPreference: honestyEnum.optional(),
    /** Short user-facing confirmation of what was understood. */
    summary: z.string().min(1).max(280),
  })
  .passthrough();

export type FittingTellExtraction = z.infer<typeof fittingTellExtractionSchema>;

type OnboardingPatch = z.infer<typeof onboardingPatchSchema>;

const SYSTEM = `You parse free-text messages written during Shoop "The Fitting" onboarding.
The user is talking to a stylist beside a multi-step form. They may mention facts for LATER steps while still on an EARLY step.
ALWAYS extract every actionable field, even if it doesn't match the current step
(e.g. brands on the name step, height on spend step, hard nos before the no-list).
Return ONE JSON object only (no markdown, no prose outside JSON).

FITTING STEPS (order): name → spend → photo → worn looks → wanted looks → brands/nolist → honesty → verdict

RULES
- Only set fields the user actually communicated. Omit unknowns entirely (do not invent).
- preferredName: first name / nickname only.
- genderPresentation: masculine | feminine | androgynous | nonbinary | "prefer not to say"
- styleEras: 0–4 from 13_14, 15_17, 18_22, 23_29, 30s, 40s, 50s_60s, 65_plus
- ageRange when they give an age band: 13-17 | 18-24 | 25-34 | 35-44 | 45-54 | 55-64 | 65+
- ageYears when they state an exact age
- budgetPhilosophies: best_value | premium | luxury | deal_hunter | design_first
- heights: prefer heightCm; if they say feet/inches set heightFt + heightIn (and heightCm if you're sure)
- weights: convert lb→kg integer when needed (weightKg)
- build: slim | average | athletic | broad | plus
- muscularity: low (soft) | moderate (toned) | high (defined/muscular)
- bodyShape: rectangle | triangle | inverted_triangle | hourglass | oval
- bustFullness: subtle | average | full | very_full (only when relevant)
- Always extract concrete facts: names ("call me X"), genders/dressing presentation,
  ages/eras, hard nos as an array, body weight in weightKg (convert lb).
- brandLikes / brandAvoids: brand names ONLY (Everlane, COS, Nike…) — not style adjectives
  "I love Everlane and Uniqlo" → brandLikes: ["Everlane","Uniqlo"]
- hardAvoids: hard style bans as short phrase array (e.g. ["logos", "neon", "skinny jeans"])
- styleLikes / styleAvoids: style descriptors (minimal, Parisian, preppy…)
- honestyPreference: gentle | straight | no_mercy (only if they request feedback tone)
- summary: warm 1-sentence confirmation. If some facts belong to later steps, say so plainly
  e.g. "Got it — Alex. Locked Everlane + no logos for brands later. Height noted for photo."
  If nothing actionable: say so briefly and leave other fields omitted.
- Never invent size numbers or brands that were not stated.
- Return numbers as JSON numbers (not strings). Always use arrays for multi-value fields.`;

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function resolveHeightCm(
  extraction: FittingTellExtraction,
): number | undefined {
  if (extraction.heightCm != null) return extraction.heightCm;
  if (extraction.heightFt != null) {
    const inches = extraction.heightIn ?? 0;
    return Math.round((extraction.heightFt * 12 + inches) * 2.54);
  }
  return undefined;
}

export function filledLabels(extraction: FittingTellExtraction): string[] {
  const labels: string[] = [];
  if (extraction.preferredName) labels.push("name");
  if (extraction.genderPresentation) labels.push("gender");
  if (extraction.styleEras?.length || extraction.ageYears || extraction.ageRange)
    labels.push("era");
  if (extraction.budgetPhilosophies?.length) labels.push("spend");
  if (resolveHeightCm(extraction) != null) labels.push("height");
  if (extraction.weightKg != null) labels.push("weight");
  if (extraction.build) labels.push("build");
  if (extraction.muscularity) labels.push("definition");
  if (extraction.bodyShape) labels.push("shape");
  if (extraction.bustFullness) labels.push("bust");
  if (extraction.brandLikes?.length) labels.push("brands loved");
  if (extraction.brandAvoids?.length) labels.push("brands avoided");
  if (extraction.hardAvoids?.length) labels.push("no-list");
  if (extraction.styleLikes?.length || extraction.styleAvoids?.length)
    labels.push("taste");
  if (extraction.honestyPreference) labels.push("honesty");
  return labels;
}

/** Group extracted facts by which left-side step they belong to. */
export function bucketsFromExtraction(
  extraction: FittingTellExtraction,
): FittingTellBucket[] {
  const buckets: FittingTellBucket[] = [];
  if (
    extraction.preferredName ||
    extraction.genderPresentation ||
    extraction.styleEras?.length ||
    extraction.ageYears != null ||
    extraction.ageRange
  ) {
    buckets.push("name");
  }
  if (extraction.budgetPhilosophies?.length) buckets.push("spend");
  if (
    resolveHeightCm(extraction) != null ||
    extraction.weightKg != null ||
    extraction.build ||
    extraction.muscularity ||
    extraction.bodyShape ||
    extraction.bustFullness
  ) {
    buckets.push("photo");
  }
  if (
    extraction.brandLikes?.length ||
    extraction.brandAvoids?.length ||
    extraction.hardAvoids?.length
  ) {
    buckets.push("nolist");
  }
  if (extraction.honestyPreference) buckets.push("honesty");
  if (extraction.styleLikes?.length || extraction.styleAvoids?.length) {
    buckets.push("taste");
  }
  return buckets;
}

const BUCKET_ORDER: FittingTellStep[] = [
  "name",
  "spend",
  "photo",
  "worn",
  "wanted",
  "nolist",
  "honesty",
  "verdict",
];

const BUCKET_STEP: Record<FittingTellBucket, FittingTellStep> = {
  name: "name",
  spend: "spend",
  photo: "photo",
  nolist: "nolist",
  honesty: "honesty",
  taste: "worn",
};

const BUCKET_LABEL: Record<FittingTellBucket, string> = {
  name: "who you are",
  spend: "spend",
  photo: "body & photo",
  nolist: "brands & no-list",
  honesty: "honesty",
  taste: "taste",
};

/**
 * Which buckets are for steps after the current one —
 * used in UX copy: "saved for brands next".
 */
export function deferredBuckets(
  extraction: FittingTellExtraction,
  currentStep?: FittingTellStep,
): FittingTellBucket[] {
  const buckets = bucketsFromExtraction(extraction);
  if (!currentStep) return buckets;
  const now = BUCKET_ORDER.indexOf(currentStep);
  if (now < 0) return buckets;
  return buckets.filter(
    (b) => BUCKET_ORDER.indexOf(BUCKET_STEP[b]) > now,
  );
}

/** Short feedback tail, e.g. " · fills brands step later". */
export function deferredFeedback(
  extraction: FittingTellExtraction,
  currentStep?: FittingTellStep,
): string {
  const deferred = deferredBuckets(extraction, currentStep);
  if (!deferred.length) return "";
  const bits = deferred.map((b) => BUCKET_LABEL[b]);
  if (bits.length === 1) return ` · saved for ${bits[0]} later`;
  return ` · saved for later: ${bits.join(", ")}`;
}

/** Case-insensitive merge of free-text lists. */
export function mergeTokenLists(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] {
  return uniqStrings([...(existing ?? []), ...(incoming ?? [])]);
}

export function buildPatchFromFittingTell(
  extraction: FittingTellExtraction,
  known: FittingTellKnown = {},
): OnboardingPatch {
  const profile: NonNullable<OnboardingPatch["profile"]> = {};
  if (extraction.preferredName?.trim()) {
    profile.preferredName = extraction.preferredName.trim();
  }
  if (extraction.genderPresentation) {
    profile.genderPresentation = normalizeGender(extraction.genderPresentation);
  }

  const eraSet = uniqStrings([
    ...(known.styleEras ?? []),
    ...(extraction.styleEras ?? []),
  ]);
  if (extraction.ageYears != null && eraSet.length === 0) {
    eraSet.push(styleEraFromAge(extraction.ageYears));
  }
  if (eraSet.length) {
    profile.styleEra = joinCsvValues(eraSet);
    profile.ageRange =
      normalizeAgeRange(extraction.ageRange) ||
      styleEraToAgeRange(eraSet.join(",")) ||
      (extraction.ageYears != null
        ? normalizeAgeRange(String(extraction.ageYears))
        : undefined) ||
      undefined;
  } else if (extraction.ageRange) {
    profile.ageRange = normalizeAgeRange(extraction.ageRange);
  } else if (extraction.ageYears != null) {
    profile.ageRange = normalizeAgeRange(String(extraction.ageYears));
    profile.styleEra = styleEraFromAge(extraction.ageYears);
  }

  const budgets = uniqStrings([
    ...(known.budgetPhilosophies ?? []),
    ...(extraction.budgetPhilosophies ?? []),
  ]);
  if (budgets.length) {
    profile.valuePhilosophy = joinCsvValues(budgets);
  }

  if (extraction.honestyPreference) {
    profile.honestyPreference = extraction.honestyPreference;
  }

  const sizing: NonNullable<OnboardingPatch["sizing"]> = {};
  const heightCm = resolveHeightCm(extraction);
  if (heightCm != null) sizing.heightCm = heightCm;
  if (extraction.weightKg != null) sizing.weightKg = extraction.weightKg;
  if (extraction.build) sizing.bodyType = extraction.build;

  const brands: NonNullable<OnboardingPatch["brands"]> = [];
  for (const brand of extraction.brandLikes ?? []) {
    brands.push({ brand: brand.trim(), sentiment: "love" });
  }
  for (const brand of extraction.brandAvoids ?? []) {
    brands.push({ brand: brand.trim(), sentiment: "avoid" });
  }

  const hardNegatives: NonNullable<OnboardingPatch["hardNegatives"]> = [];
  for (const value of extraction.hardAvoids ?? []) {
    const v = value.trim();
    if (v) hardNegatives.push({ scope: "style", value: v, reason: "taste" });
  }

  const tasteTags: NonNullable<OnboardingPatch["tasteTags"]> = [];
  for (const tag of tagsFromFreeText(
    (extraction.styleLikes ?? []).join(", "),
  )) {
    tasteTags.push({ tag, polarity: "positive" });
  }
  for (const tag of tagsFromFreeText(
    (extraction.styleAvoids ?? []).join(", "),
  )) {
    tasteTags.push({ tag, polarity: "negative" });
  }

  const patch: OnboardingPatch = {};
  if (Object.keys(profile).length) patch.profile = profile;
  if (Object.keys(sizing).length) patch.sizing = sizing;
  if (brands.length) patch.brands = brands;
  if (hardNegatives.length) patch.hardNegatives = hardNegatives;
  if (tasteTags.length) patch.tasteTags = tasteTags;
  return patch;
}

/** Client-facing prefill for immediate form merge when status hydrate misses UI-only fields. */
export function prefillFromFittingTell(
  extraction: FittingTellExtraction,
): Record<string, string | number | string[] | undefined> {
  const heightCm = resolveHeightCm(extraction);
  return {
    preferredName: extraction.preferredName,
    genderPresentation: extraction.genderPresentation
      ? normalizeGender(extraction.genderPresentation)
      : undefined,
    ageRange: extraction.ageRange
      ? normalizeAgeRange(extraction.ageRange)
      : undefined,
    styleEras: extraction.styleEras?.length
      ? extraction.styleEras.join(",")
      : extraction.ageYears != null
        ? styleEraFromAge(extraction.ageYears)
        : undefined,
    budgetPhilosophy: extraction.budgetPhilosophies?.length
      ? extraction.budgetPhilosophies.join(",")
      : undefined,
    brandLikes: extraction.brandLikes?.join(", "),
    brandAvoids: extraction.brandAvoids?.join(", "),
    hardAvoids: extraction.hardAvoids?.join(", "),
    honestyPreference: extraction.honestyPreference,
    heightCm,
    weightKg: extraction.weightKg,
    build: extraction.build,
    muscularity: extraction.muscularity,
    bodyShape: extraction.bodyShape,
    bustFullness: extraction.bustFullness,
  };
}

export async function extractFittingTell(params: {
  text: string;
  known?: FittingTellKnown;
  signal?: AbortSignal;
  audit?: LightweightPromptAudit;
}): Promise<FittingTellExtraction | null> {
  const knownLines: string[] = [];
  const known = params.known ?? {};
  if (known.currentStep) {
    knownLines.push(
      `currentFittingStep: ${known.currentStep} (still extract brandLikes, hardAvoids, spend, body fields, honesty even if for later steps)`,
    );
  }
  if (known.preferredName) knownLines.push(`name: ${known.preferredName}`);
  if (known.genderPresentation)
    knownLines.push(`gender: ${known.genderPresentation}`);
  if (known.styleEras?.length)
    knownLines.push(`eras: ${known.styleEras.join(", ")}`);
  if (known.budgetPhilosophies?.length)
    knownLines.push(`spend: ${known.budgetPhilosophies.join(", ")}`);
  if (known.brandLikes?.length)
    knownLines.push(`brands liked: ${known.brandLikes.join(", ")}`);
  if (known.brandAvoids?.length)
    knownLines.push(`brands avoided: ${known.brandAvoids.join(", ")}`);
  if (known.hardAvoids?.length)
    knownLines.push(`no-list: ${known.hardAvoids.join(", ")}`);
  if (known.honestyPreference)
    knownLines.push(`honesty: ${known.honestyPreference}`);
  if (known.heightCm) knownLines.push(`heightCm: ${known.heightCm}`);
  if (known.build) knownLines.push(`build: ${known.build}`);

  const userContent = [
    knownLines.length
      ? `Context (merge NEW facts into JSON fields; keep existing unless contradicted):\n${knownLines.join("\n")}`
      : "Form is mostly empty.",
    "",
    "CRITICAL: capture brands loved/avoided and hard avoids whenever mentioned, even on step 1.",
    "",
    "User free-text:",
    params.text.trim(),
  ].join("\n");

  let msg;
  try {
    msg = await createLightweightMessage(
      {
        model: AI_CHAT_LIGHTWEIGHT_MODEL,
        max_tokens: 700,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
      },
      params.audit
        ? { signal: params.signal, audit: params.audit }
        : params.signal
          ? { signal: params.signal }
          : undefined,
    );
  } catch {
    return null;
  }

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;

  const parsedJson = parseLlmJsonObject(block.text);
  if (!parsedJson) return null;

  const cleaned = normalizeFittingTellRaw(stripNullFields(parsedJson.value));
  const out = fittingTellExtractionSchema.safeParse(cleaned);
  let extraction: FittingTellExtraction;
  if (!out.success) {
    // Soft salvage: keep fields that can still be read loosely.
    const asRec =
      cleaned && typeof cleaned === "object"
        ? (cleaned as Record<string, unknown>)
        : {};
    const summary =
      typeof asRec.summary === "string" && asRec.summary.trim()
        ? asRec.summary.trim().slice(0, 280)
        : "Noted — keep going.";
    const salvage: FittingTellExtraction = { summary };
    if (typeof asRec.preferredName === "string" && asRec.preferredName.trim()) {
      salvage.preferredName = asRec.preferredName.trim().slice(0, 80);
    }
    const brands = asStringArray(asRec.brandLikes);
    if (brands?.length) salvage.brandLikes = brands.slice(0, 12);
    const avoids = asStringArray(asRec.brandAvoids);
    if (avoids?.length) salvage.brandAvoids = avoids.slice(0, 12);
    const hard = asStringArray(asRec.hardAvoids);
    if (hard?.length) salvage.hardAvoids = hard.slice(0, 16);
    extraction = salvage;
  } else {
    const data = out.data;
    extraction = {
      preferredName: data.preferredName,
      genderPresentation: data.genderPresentation,
      styleEras: data.styleEras,
      ageRange: data.ageRange,
      ageYears: data.ageYears,
      budgetPhilosophies: data.budgetPhilosophies,
      heightCm: data.heightCm,
      heightFt: data.heightFt,
      heightIn: data.heightIn,
      weightKg: data.weightKg,
      build: data.build,
      muscularity: data.muscularity,
      bodyShape: data.bodyShape,
      bustFullness: data.bustFullness,
      brandLikes: data.brandLikes,
      brandAvoids: data.brandAvoids,
      hardAvoids: data.hardAvoids,
      styleLikes: data.styleLikes,
      styleAvoids: data.styleAvoids,
      honestyPreference: data.honestyPreference,
      summary: data.summary,
    };
  }
  return backfillFittingTellFromText(params.text, extraction);
}
