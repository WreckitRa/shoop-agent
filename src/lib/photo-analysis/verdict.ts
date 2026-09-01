import { createHash } from "node:crypto";
import { PHOTO_ERROR } from "./errors";
import { callPhotoJsonSchema, withPhotoGptLock } from "./openai";
import {
  STYLIST_READING_INSTRUCTIONS,
  STYLIST_READING_SCHEMA,
  STYLIST_VERDICT_INSTRUCTIONS,
  STYLIST_VERDICT_SCHEMA_DESCRIPTION,
  STYLIST_VERDICT_SCHEMA_NAME,
} from "./verdict-prompt";

export const DEFAULT_STYLIST_VERDICT_MODEL = "gpt-5.6-sol";
/** Hang-safety for the reading-card call. Not a quality budget. */
export const VERDICT_TIMEOUT_MS = 90_000;
export const VERDICT_STALE_MS = VERDICT_TIMEOUT_MS + 20_000;
const VERDICT_MAX_OUTPUT_TOKENS = 16_000;

export function stylistVerdictModel(): string {
  const override = process.env.OPENAI_STYLIST_VERDICT_MODEL?.trim();
  return override || DEFAULT_STYLIST_VERDICT_MODEL;
}

export const STYLIST_VERDICT_ROOT_KEYS = [
  "verdict_status",
  "executive_verdict",
  "style_identity",
  "color_system",
  "proportion_and_silhouette",
  "size_and_fit",
  "garment_playbook",
  "fabrics_patterns_and_climate",
  "grooming_and_accessories",
  "outfit_formulas",
  "wardrobe_plan",
  "shopping_engine_profile",
  "user_facing_verdict",
] as const;

export type UserFacingVerdict = {
  title: string;
  opening: string;
  golden_rules: string[];
  mistakes_to_avoid: string[];
  first_five_actions: string[];
  confidence_note: string;
  review_trigger: string;
};

export type ExecutiveVerdict = {
  headline: string;
  profile_summary: string;
  signature_style_statement: string;
  desired_impression: string[];
  impressions_to_avoid: string[];
  strongest_assets: string[];
  biggest_opportunities: string[];
  non_negotiables: string[];
  top_priorities: string[];
};

export type VerdictStatus = {
  readiness: "final" | "provisional" | "blocked";
  overall_confidence: number;
  data_completeness: number;
  sources_used: string[];
  remaining_unknowns: unknown[];
  assumptions: string[];
  verdict_scope: string;
};

export type StylistVerdict = {
  verdict_status: VerdictStatus;
  executive_verdict: ExecutiveVerdict;
  user_facing_verdict: UserFacingVerdict;
  [key: string]: unknown;
};

export function parseStylistVerdict(raw: unknown): StylistVerdict | null {
  const hydrated = hydrateStylistVerdict(raw);
  if (!hydrated || typeof hydrated !== "object") return null;
  const o = hydrated as Record<string, unknown>;
  for (const key of STYLIST_VERDICT_ROOT_KEYS) {
    if (!(key in o)) return null;
  }
  const status = o.verdict_status;
  if (!status || typeof status !== "object") return null;
  const readiness = (status as { readiness?: unknown }).readiness;
  if (
    readiness !== "final" &&
    readiness !== "provisional" &&
    readiness !== "blocked"
  ) {
    return null;
  }
  const face = o.user_facing_verdict;
  if (!face || typeof face !== "object") return null;
  if (typeof (face as { title?: unknown }).title !== "string") return null;
  const exec = o.executive_verdict;
  if (!exec || typeof exec !== "object") return null;
  if (typeof (exec as { headline?: unknown }).headline !== "string") return null;
  return hydrated as StylistVerdict;
}

/** Fill unused shopping-engine roots so a reading-card payload still parses. */
export function hydrateStylistVerdict(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of STYLIST_VERDICT_ROOT_KEYS) {
    if (key in out) continue;
    out[key] = key === "garment_playbook" || key === "outfit_formulas" ? [] : {};
  }
  return out;
}

function isFilledRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function listPresentDomains(input: {
  questionnaireAnswers: Record<string, unknown>;
  measurements: Record<string, unknown>;
  wardrobeInventory: Record<string, unknown>;
  userReview: Record<string, unknown>;
  photoAnalysis: Record<string, unknown>;
}): string[] {
  const domains: string[] = [];
  const q = input.questionnaireAnswers;
  const identity = isFilledRecord(q.identity) ? q.identity : q;
  if (identity.gender_presentation || identity.age_years || identity.style_era) {
    domains.push("identity");
  }
  const lifestyle = isFilledRecord(q.lifestyle) ? q.lifestyle : null;
  if (lifestyle?.week_is || q.goal) domains.push("lifestyle");
  if (q.climate || q.climate_label) domains.push("climate");
  const budget = isFilledRecord(q.budget) ? q.budget : null;
  if (budget?.philosophy) domains.push("budget");
  const taste = isFilledRecord(q.taste) ? q.taste : null;
  if (taste?.style_mix || taste?.honesty || Array.isArray(taste?.compliments)) {
    domains.push("taste");
  }
  const body = isFilledRecord(input.measurements.body)
    ? input.measurements.body
    : input.measurements;
  if (body.height_cm || body.weight_kg || body.body_type) domains.push("body");
  const w = input.wardrobeInventory;
  if (
    (Array.isArray(w.worn) && w.worn.length) ||
    (Array.isArray(w.wanted) && w.wanted.length)
  ) {
    domains.push("wardrobe");
  }
  if (Array.isArray(w.comfort) && w.comfort.length) domains.push("comfort");
  if (
    (Array.isArray(w.brands_avoid) && w.brands_avoid.length) ||
    (Array.isArray(w.style_vetoes) && w.style_vetoes.length)
  ) {
    domains.push("vetoes");
  }
  const review = input.userReview;
  if (
    Array.isArray(review.confirmed_paths) ||
    Array.isArray(review.corrections)
  ) {
    domains.push("face_scan");
  } else if (input.photoAnalysis.analysis_status) {
    domains.push("face_scan");
  }
  return domains;
}

export type GenerateStylistVerdictInput = {
  photoAnalysis: Record<string, unknown>;
  userReview: Record<string, unknown>;
  questionnaireAnswers: Record<string, unknown>;
  measurements: Record<string, unknown>;
  wardrobeInventory?: Record<string, unknown>;
  applicationContext?: Record<string, unknown>;
  safetyIdentifier?: string;
};

export async function generateStylistVerdict({
  photoAnalysis,
  userReview,
  questionnaireAnswers,
  measurements,
  wardrobeInventory = {},
  applicationContext = {},
  safetyIdentifier,
}: GenerateStylistVerdictInput): Promise<StylistVerdict> {
  const present_domains = listPresentDomains({
    questionnaireAnswers,
    measurements,
    wardrobeInventory,
    userReview,
    photoAnalysis,
  });

  const profilePayload = {
    task: "Generate the canonical personal-stylist verdict from this reviewed profile.",
    data_manifest: {
      present_domains,
      instruction:
        "Every domain in present_domains must change the verdict. Cite each in based_on.",
    },
    photo_analysis: photoAnalysis,
    user_review: userReview,
    questionnaire_answers: questionnaireAnswers,
    measurements,
    wardrobe_inventory: wardrobeInventory,
    application_context: applicationContext,
  };

  const started = Date.now();
  return withPhotoGptLock(async () => {
    const remaining = VERDICT_TIMEOUT_MS - (Date.now() - started);
    if (remaining < 8_000) throw new Error(PHOTO_ERROR.timeout);
    const raw = await callPhotoJsonSchema({
      model: stylistVerdictModel(),
      // low: medium + the full catalog schema burned the 16k cap and sat
      // on the Fitting screen past five minutes. Reading-card schema only.
      reasoning: { effort: "low" },
      instructions: `${STYLIST_VERDICT_INSTRUCTIONS}\n${STYLIST_READING_INSTRUCTIONS}`,
      userContent: [
        { type: "input_text", text: JSON.stringify(profilePayload) },
      ],
      format: {
        name: STYLIST_VERDICT_SCHEMA_NAME,
        description: STYLIST_VERDICT_SCHEMA_DESCRIPTION,
        schema: STYLIST_READING_SCHEMA,
      },
      maxOutputTokens: VERDICT_MAX_OUTPUT_TOKENS,
      timeoutMs: remaining,
      safetyIdentifier,
      incompleteError: PHOTO_ERROR.verdict_incomplete,
    });
    const verdict = parseStylistVerdict(raw);
    if (!verdict) throw new Error(PHOTO_ERROR.non_json);
    return verdict;
  });
}

export function hashedSafetyIdentifier(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}
