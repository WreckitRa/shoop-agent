import { createHash } from "node:crypto";
import { PHOTO_ERROR } from "./errors";
import { callPhotoJsonSchema, withPhotoGptLock } from "./openai";
import {
  STYLIST_VERDICT_INSTRUCTIONS,
  STYLIST_VERDICT_SCHEMA,
  STYLIST_VERDICT_SCHEMA_DESCRIPTION,
  STYLIST_VERDICT_SCHEMA_NAME,
} from "./verdict-prompt";

export const DEFAULT_STYLIST_VERDICT_MODEL = "gpt-5.6-sol";
const VERDICT_TIMEOUT_MS = 250_000;
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
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
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
  return raw as StylistVerdict;
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
  const profilePayload = {
    task: "Generate the canonical personal-stylist verdict from this reviewed profile.",
    photo_analysis: photoAnalysis,
    user_review: userReview,
    questionnaire_answers: questionnaireAnswers,
    measurements,
    wardrobe_inventory: wardrobeInventory,
    application_context: applicationContext,
  };

  return withPhotoGptLock(async () => {
    const raw = await callPhotoJsonSchema({
      model: stylistVerdictModel(),
      reasoning: { effort: "high" },
      instructions: STYLIST_VERDICT_INSTRUCTIONS,
      userContent: [
        { type: "input_text", text: JSON.stringify(profilePayload) },
      ],
      format: {
        name: STYLIST_VERDICT_SCHEMA_NAME,
        description: STYLIST_VERDICT_SCHEMA_DESCRIPTION,
        schema: STYLIST_VERDICT_SCHEMA,
      },
      maxOutputTokens: VERDICT_MAX_OUTPUT_TOKENS,
      timeoutMs: VERDICT_TIMEOUT_MS,
      safetyIdentifier,
    });
    const verdict = parseStylistVerdict(raw);
    if (!verdict) throw new Error(PHOTO_ERROR.non_json);
    return verdict;
  });
}

export function hashedSafetyIdentifier(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}
