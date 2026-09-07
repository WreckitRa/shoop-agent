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
  CLIMATE_OPTIONS,
  GENDER_OPTIONS,
  HONESTY_OPTIONS,
  KIDS_OPTIONS,
  STYLE_ERAS,
  WEEK_IS_OPTIONS,
  WEEKEND_OPTIONS,
  joinCsvValues,
  lifestyleTagsFromLife,
  normalizeAgeRange,
  normalizeClimate,
  normalizeGender,
  normalizeHonestyPreference,
  parseCsvValues,
  styleEraFromAge,
  styleEraToAgeRange,
} from "@/lib/onboarding/form-options";
import { tagsFromFreeText } from "@/lib/onboarding/taste-tags";
import { logFitting } from "@/lib/onboarding/fitting-trace";

export type FittingTellStep =
  | "consent"
  | "photo"
  | "name"
  | "life"
  | "spend"
  | "fit"
  | "worn"
  | "corner"
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
  comfort?: string[];
  weekIs?: string;
  dressingFor?: string;
  weekendsAre?: string;
  kids?: string;
  climate?: string;
  honestyPreference?: string;
  styleFriction?: string;
  styleBecome?: string;
  heightCm?: number | null;
  weightKg?: number | null;
  build?: string | null;
  /** Step the user is on in The Fitting. */
  currentStep?: FittingTellStep;
};

/** Where each extracted fact surfaces in the left-side flow. */
export type FittingTellBucket =
  | "name"
  | "life"
  | "spend"
  | "fit"
  | "nolist"
  | "honesty"
  | "taste"
  | "corner";

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
const dressingForField = z.string().max(240).optional();
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

function csvLifeTokens(
  v: unknown,
  allowed: Set<string>,
  max: number,
): string | undefined {
  const parts = asStringArray(v);
  if (!parts?.length) return undefined;
  const kept = parts.filter(
    (p) => allowed.has(p) || p === "other" || p.startsWith("other:"),
  );
  if (!kept.length) return undefined;
  return joinCsvValues(kept).slice(0, max);
}

function lifeCsv(allowed: Set<string>, max: number) {
  return z.preprocess(
    (v) => csvLifeTokens(v, allowed, max),
    z.string().max(max).optional(),
  );
}

const WEEK_VALUES = new Set(WEEK_IS_OPTIONS.map((o) => o.value));
const WEEKEND_VALUES = new Set(WEEKEND_OPTIONS.map((o) => o.value));
const KIDS_VALUES = new Set(KIDS_OPTIONS.map((o) => o.value));
const CLIMATE_VALUES = new Set(CLIMATE_OPTIONS.map((o) => o.value));

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
      out.honestyPreference = "5";
    else if (/\bhit me easy|gentle|soft nudge\b/i.test(t))
      out.honestyPreference = "1";
    else if (/\bstraight with me|be (straight|direct|honest)\b/i.test(t))
      out.honestyPreference = "3";
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

  if (!out.weekIs) {
    if (/\b(student|studying|at (?:uni|college))\b/i.test(t))
      out.weekIs = "studying";
    else if (/\bwork(?:ing)? from home|\bwfh\b/i.test(t))
      out.weekIs = "working_home";
    else if (/\bon[-\s]?site|in the office\b/i.test(t))
      out.weekIs = "working_onsite";
    else if (/\bretired\b/i.test(t)) out.weekIs = "retired";
    else if (/\bhome with (?:the )?kids\b/i.test(t))
      out.weekIs = "home_with_kids";
  }

  if (!out.dressingFor) {
    if (/\bput together at work|without trying so hard|work polish\b/i.test(t)) {
      out.dressingFor = "work_polish";
    } else if (/\bfeel like myself\b/i.test(t)) {
      out.dressingFor = "feel_like_me";
    } else if (/\bnights out|for (?:nights|events)\b/i.test(t)) {
      out.dressingFor = "nights_out";
    } else if (/\bnever wear|stop buying\b/i.test(t)) {
      out.dressingFor = "stop_wasting";
    } else if (
      /\b(?:figure|find)(?:\s+out)?\s+my style|don'?t have a style|help me find (?:out )?my style\b/i.test(
        t,
      )
    ) {
      out.dressingFor = "find_style";
    } else if (/\bnot (?:dating|right now)\b/i.test(t)) {
      out.dressingFor = "not_right_now";
    } else if (/\bdating\b/i.test(t)) {
      out.dressingFor = "dating";
    } else if (/\b(married|partner|with someone|in a relationship)\b/i.test(t)) {
      out.dressingFor = "with_someone";
    }
  }

  if (!out.weekendsAre) {
    const bits: string[] = [];
    if (/\bout with friends|with friends\b/i.test(t)) bits.push("friends");
    if (/\bfamily time|with (?:the )?family\b/i.test(t)) bits.push("family");
    if (/\bnightlife|nights out\b/i.test(t)) bits.push("nightlife");
    if (/\bhome and rest|stay(?:ing)? home\b/i.test(t)) bits.push("home");
    if (/\boutdoors|hiking\b/i.test(t)) bits.push("outdoors");
    if (/\berrands\b/i.test(t)) bits.push("errands");
    if (/\btravel(?:ing|ling)?\b/i.test(t)) bits.push("travel");
    if (bits.length) out.weekendsAre = joinCsvValues(bits);
  }

  if (!out.kids) {
    if (/\bno kids|don'?t have kids|child[- ]?free\b/i.test(t)) out.kids = "none";
    else if (/\b(toddler|young kids|babies|preschool)\b/i.test(t))
      out.kids = "young";
    else if (/\b(teenagers|older kids)\b/i.test(t)) out.kids = "older";
  }

  if (!out.climate) {
    const climate = normalizeClimate(t);
    if (climate) out.climate = climate;
    else if (/\bhot and humid|\bhumid\b/i.test(t)) out.climate = "hot_humid";
    else if (/\bhot and dry\b/i.test(t)) out.climate = "hot_dry";
    else if (/\bfour seasons\b/i.test(t)) out.climate = "four_seasons";
    else if (/\bmild and wet\b/i.test(t)) out.climate = "mild_wet";
  }

  if (!out.comfort?.length) {
    const c: string[] = [];
    if (/\bno heels\b/i.test(t)) c.push("no heels");
    if (/\bnothing sleeveless|no sleeveless\b/i.test(t))
      c.push("nothing sleeveless");
    if (c.length) out.comfort = c;
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
    const mapped = normalizeHonestyPreference(o.honestyPreference);
    if (mapped) o.honestyPreference = mapped;
    else delete o.honestyPreference;
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
    comfort: z.array(z.string().min(1).max(80)).max(16).optional(),
    weekIs: lifeCsv(WEEK_VALUES, 240),
    dressingFor: dressingForField,
    weekendsAre: lifeCsv(WEEKEND_VALUES, 240),
    kids: lifeCsv(KIDS_VALUES, 80),
    climate: lifeCsv(CLIMATE_VALUES, 240),
    styleLikes: z.array(z.string().min(1).max(60)).max(16).optional(),
    styleAvoids: z.array(z.string().min(1).max(60)).max(16).optional(),
    honestyPreference: honestyEnum.optional(),
    styleFriction: z.string().min(1).max(2000).optional(),
    styleBecome: z.string().min(1).max(2000).optional(),
    /** Short user-facing confirmation of what was understood. */
    summary: z.string().min(1).max(280),
  })
  .passthrough();

export type FittingTellExtraction = z.infer<typeof fittingTellExtractionSchema>;

type OnboardingPatch = z.infer<typeof onboardingPatchSchema>;

const SYSTEM = `You parse free-text messages written during Shoop "The Fitting" onboarding.
The user is talking to a stylist beside a multi-step form. They may mention facts for LATER steps while still on an EARLY step.
ALWAYS extract every actionable field, even if it doesn't match the current step
(e.g. brands on the name step, height on the photo step, hard nos before the no-list).
Return ONE JSON object only (no markdown, no prose outside JSON).

FITTING STEPS (order): consent → photo → name → fit (height/build) → life → spend → worn looks → honest corner → brands/nolist → honesty → verdict

RULES
- Only set fields the user actually communicated. Omit unknowns entirely (do not invent).
- preferredName: first name / nickname only.
- genderPresentation: menswear | womenswear | both (aliases masculine/feminine/androgynous also accepted)
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
- comfort: hard predicates she will not wear (e.g. ["no heels", "nothing sleeveless"])
- weekIs: CSV of studying | working_onsite | working_home | working_mixed | own_thing | home_with_kids | between_things | retired
- dressingFor: work_polish | feel_like_me | nights_out | stop_wasting | find_style | other:<their words>
  (why they opened the Fitting — not dating status)
- weekendsAre: CSV of home | friends | family | outdoors | errands | nightlife | travel
- kids: CSV of young | older | none
- climate: CSV of hot_humid | hot_dry | four_seasons | mild_wet | cold
- styleLikes / styleAvoids: style descriptors (minimal, Parisian, preppy…)
- styleFriction: what they dislike in their CURRENT style — keep their words as
  free prose (not chip tags). "I look sloppy / everything is hoodies" → styleFriction.
- styleBecome: who they want to become / what they want to improve toward — keep
  their words. "more tailored, like I chose this" → styleBecome.
- honestyPreference: 1 | 2 | 3 | 4 | 5 (only if they request feedback tone)
- summary: warm 1-sentence confirmation. If some facts belong to later steps, say so plainly
  e.g. "Got it — Alex. Locked Everlane + no logos for brands later. Height noted for fit."
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
  if (extraction.comfort?.length) labels.push("comfort");
  if (
    extraction.weekIs ||
    extraction.weekendsAre ||
    extraction.dressingFor ||
    extraction.kids ||
    extraction.climate
  )
    labels.push("life");
  if (extraction.styleLikes?.length || extraction.styleAvoids?.length)
    labels.push("taste");
  if (extraction.honestyPreference) labels.push("honesty");
  if (extraction.styleFriction || extraction.styleBecome) labels.push("honest corner");
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
  if (
    extraction.weekIs ||
    extraction.weekendsAre ||
    extraction.dressingFor ||
    extraction.kids ||
    extraction.climate
  ) {
    buckets.push("life");
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
    buckets.push("fit");
  }
  if (
    extraction.brandLikes?.length ||
    extraction.brandAvoids?.length ||
    extraction.hardAvoids?.length ||
    extraction.comfort?.length
  ) {
    buckets.push("nolist");
  }
  if (extraction.honestyPreference) buckets.push("honesty");
  if (extraction.styleFriction || extraction.styleBecome) buckets.push("corner");
  if (extraction.styleLikes?.length || extraction.styleAvoids?.length) {
    buckets.push("taste");
  }
  return buckets;
}

const BUCKET_ORDER: FittingTellStep[] = [
  "consent",
  "photo",
  "name",
  "life",
  "spend",
  "fit",
  "worn",
  "corner",
  "nolist",
  "honesty",
  "verdict",
];

const BUCKET_STEP: Record<FittingTellBucket, FittingTellStep> = {
  name: "name",
  life: "life",
  spend: "spend",
  fit: "fit",
  nolist: "nolist",
  honesty: "honesty",
  taste: "worn",
  corner: "corner",
};

const BUCKET_LABEL: Record<FittingTellBucket, string> = {
  name: "who you are",
  life: "your week",
  spend: "spend",
  fit: "body & fit",
  nolist: "brands & no-list",
  honesty: "honesty",
  taste: "taste",
  corner: "honest corner",
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
  const now = BUCKET_ORDER.indexOf(
    currentStep === "wanted" ? "corner" : currentStep,
  );
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

function mergeCsvField(known?: string, incoming?: string): string | undefined {
  const merged = uniqStrings([
    ...parseCsvValues(known),
    ...parseCsvValues(incoming),
  ]);
  return merged.length ? joinCsvValues(merged) : undefined;
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
  if (extraction.styleFriction?.trim()) {
    profile.styleFriction = extraction.styleFriction.trim();
  }
  if (extraction.styleBecome?.trim()) {
    profile.styleBecome = extraction.styleBecome.trim();
  }
  if (extraction.weekIs) {
    profile.weekIs = mergeCsvField(known.weekIs, extraction.weekIs);
  }
  if (extraction.weekendsAre) {
    profile.weekendsAre = mergeCsvField(
      known.weekendsAre,
      extraction.weekendsAre,
    );
  }
  if (extraction.dressingFor) profile.dressingFor = extraction.dressingFor;
  if (extraction.kids) {
    profile.kids = mergeCsvField(known.kids, extraction.kids);
  }
  if (extraction.climate) {
    profile.climate = mergeCsvField(known.climate, extraction.climate);
  }
  const lifeTags = lifestyleTagsFromLife({
    weekIs: mergeCsvField(known.weekIs, extraction.weekIs) ?? known.weekIs,
    kids: mergeCsvField(known.kids, extraction.kids) ?? known.kids,
  });
  if (lifeTags.length) profile.lifestyleTags = lifeTags;

  const sizing: NonNullable<OnboardingPatch["sizing"]> = {};
  const heightCm = resolveHeightCm(extraction);
  if (heightCm != null) sizing.heightCm = heightCm;
  if (extraction.weightKg != null) sizing.weightKg = extraction.weightKg;
  if (extraction.build) sizing.bodyType = extraction.build;
  if (extraction.comfort?.length) {
    sizing.sensitivities = extraction.comfort.map((c) => c.trim()).filter(Boolean);
  }

  const brands: NonNullable<OnboardingPatch["brands"]> = [];
  for (const brand of extraction.brandLikes ?? []) {
    brands.push({ brand: brand.trim(), sentiment: "love" });
  }
  for (const brand of extraction.brandAvoids ?? []) {
    brands.push({ brand: brand.trim(), sentiment: "avoid" });
  }

  const hardNegatives: NonNullable<OnboardingPatch["hardNegatives"]> = [];
  const comfortSet = new Set(
    (extraction.comfort ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  for (const value of extraction.hardAvoids ?? []) {
    const v = value.trim();
    if (!v || comfortSet.has(v.toLowerCase())) continue;
    hardNegatives.push({ scope: "style", value: v, reason: "taste" });
  }
  for (const value of extraction.comfort ?? []) {
    const v = value.trim();
    if (v) {
      hardNegatives.push({
        scope: "fit",
        value: v,
        reason: "other",
        note: "comfort",
      });
    }
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
    comfort: extraction.comfort?.join(", "),
    weekIs: extraction.weekIs,
    dressingFor: extraction.dressingFor,
    weekendsAre: extraction.weekendsAre,
    kids: extraction.kids,
    climate: extraction.climate,
    honestyPreference: extraction.honestyPreference,
    styleFriction: extraction.styleFriction,
    styleBecome: extraction.styleBecome,
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
  if (known.comfort?.length)
    knownLines.push(`comfort: ${known.comfort.join(", ")}`);
  if (known.weekIs) knownLines.push(`weekIs: ${known.weekIs}`);
  if (known.weekendsAre) knownLines.push(`weekendsAre: ${known.weekendsAre}`);
  if (known.dressingFor) knownLines.push(`dressingFor: ${known.dressingFor}`);
  if (known.kids) knownLines.push(`kids: ${known.kids}`);
  if (known.climate) knownLines.push(`climate: ${known.climate}`);
  if (known.honestyPreference)
    knownLines.push(`honesty: ${known.honestyPreference}`);
  if (known.styleFriction)
    knownLines.push(`styleFriction: ${known.styleFriction}`);
  if (known.styleBecome) knownLines.push(`styleBecome: ${known.styleBecome}`);
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

  logFitting("fitting_tell.call", {
    step: known.currentStep ?? null,
    text: params.text,
    known,
  });

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
  } catch (error) {
    logFitting("fitting_tell.error", {
      error: error instanceof Error ? error.message : "tell failed",
    });
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
    const comfort = asStringArray(asRec.comfort);
    if (comfort?.length) salvage.comfort = comfort.slice(0, 16);
    if (typeof asRec.styleFriction === "string" && asRec.styleFriction.trim()) {
      salvage.styleFriction = asRec.styleFriction.trim().slice(0, 2000);
    }
    if (typeof asRec.styleBecome === "string" && asRec.styleBecome.trim()) {
      salvage.styleBecome = asRec.styleBecome.trim().slice(0, 2000);
    }
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
      comfort: data.comfort,
      weekIs: data.weekIs,
      dressingFor: data.dressingFor,
      weekendsAre: data.weekendsAre,
      kids: data.kids,
      climate: data.climate,
      styleLikes: data.styleLikes,
      styleAvoids: data.styleAvoids,
      honestyPreference: data.honestyPreference,
      styleFriction: data.styleFriction,
      styleBecome: data.styleBecome,
      summary: data.summary,
    };
  }
  const filled = backfillFittingTellFromText(params.text, extraction);
  logFitting("fitting_tell.result", {
    salvaged: !out.success,
    raw: block.text,
    extraction: filled,
  });
  return filled;
}
