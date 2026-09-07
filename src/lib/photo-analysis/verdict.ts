import { createHash } from "node:crypto";
import { PHOTO_ERROR } from "./errors";
import {
  callPhotoJsonSchema,
  type PhotoUsageTokens,
} from "./openai";
import { buildFittingVerdictBrief } from "./fitting-verdict-brief";
import {
  FITTING_VERDICT_INSTRUCTIONS,
  FITTING_VERDICT_REPAIR_INSTRUCTIONS,
  FITTING_VERDICT_SCHEMA,
  FITTING_VERDICT_SCHEMA_DESCRIPTION,
  FITTING_VERDICT_SCHEMA_NAME,
} from "./fitting-verdict-prompt";
import { parseStyleUserReview } from "./review";
import { logFitting } from "@/lib/onboarding/fitting-trace";
import {
  parseFittingVerdict,
  validateStyleContract,
  type FittingVerdict,
} from "./style-contract";

export const DEFAULT_STYLIST_VERDICT_MODEL = "gpt-5.6-sol";
/** Hang-safety only for the LLM call itself. */
export const VERDICT_TIMEOUT_MS = 600_000;
/** If after() died and heartbeats stop, GET flags the row instead of spinning. */
export const VERDICT_STALE_MS = 45_000;
/** Last good Sol parse was ~4.5k output tokens. 64k lets it ramble for minutes. */
const VERDICT_MAX_OUTPUT_TOKENS = 8_000;

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
  reading?: FittingVerdict["reading"];
  contract?: FittingVerdict["contract"];
  [key: string]: unknown;
};

function emptyExec(headline: string, summary: string): ExecutiveVerdict {
  return {
    headline,
    profile_summary: summary,
    signature_style_statement: "",
    desired_impression: [],
    impressions_to_avoid: [],
    strongest_assets: [],
    biggest_opportunities: [],
    non_negotiables: [],
    top_priorities: [],
  };
}

/** Bridge the fitting shape onto the stored 9-root so old readers still parse. */
export function attachFittingVerdict(fitting: FittingVerdict): StylistVerdict {
  const { reading, contract } = fitting;
  const opening = [reading.who_you_are, reading.the_shift]
    .filter(Boolean)
    .join(" ");
  return {
    reading,
    contract,
    verdict_status: {
      readiness: "final",
      overall_confidence: 1,
      data_completeness: 1,
      sources_used: ["fitting"],
      remaining_unknowns: [],
      assumptions: [],
      verdict_scope: "fitting card",
    },
    executive_verdict: emptyExec(reading.headline, reading.who_you_are),
    user_facing_verdict: {
      title: reading.headline,
      opening,
      golden_rules: reading.rules.map((r) => r.rule),
      mistakes_to_avoid: contract.palette.avoid_near_face.map(
        (s) => s.why || s.shade,
      ),
      first_five_actions: contract.looks.slice(0, 5).map((l) => l.name),
      confidence_note: "",
      review_trigger: "",
    },
    color_system: {
      near_face_colors: contract.palette.near_face.map((s) => ({
        name: s.shade,
        representative_hex: s.hex,
        priority: "essential",
        best_uses: ["near face"],
        notes: s.family,
      })),
      core_colors: contract.palette.core.map((s) => ({
        name: s.shade,
        representative_hex: s.hex,
        priority: "strong",
        best_uses: [],
        notes: s.family,
      })),
      best_neutrals: contract.palette.neutrals.map((s) => ({
        name: s.shade,
        representative_hex: s.hex,
        priority: "essential",
        best_uses: [],
        notes: s.family,
      })),
      accent_colors: contract.palette.accents.map((s) => ({
        name: s.shade,
        representative_hex: s.hex,
        priority: "accent",
        best_uses: [],
        notes: s.family,
      })),
      use_carefully: contract.palette.avoid_near_face.map((s) => ({
        color_or_family: s.shade,
        issue: s.why,
        how_to_wear: s.fix,
        representative_hex: s.hex,
      })),
    },
    outfit_formulas: contract.looks.map((look) => ({
      occasion: look.name,
      formula: look.pieces
        .filter((p) => p.slot !== "shoes")
        .map((p) => `${p.shade} ${p.garment_type}`),
      footwear: look.pieces
        .filter((p) => p.slot === "shoes")
        .map((p) => `${p.shade} ${p.garment_type}`),
      color_options: [],
    })),
  };
}

export function parseStylistVerdict(raw: unknown): StylistVerdict | null {
  const fitting = parseFittingVerdict(raw);
  if (fitting) return attachFittingVerdict(fitting);
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

export type GenerateStylistVerdictInput = {
  photoAnalysis: Record<string, unknown>;
  userReview: Record<string, unknown>;
  questionnaireAnswers: Record<string, unknown>;
  measurements: Record<string, unknown>;
  wardrobeInventory?: Record<string, unknown>;
  applicationContext?: Record<string, unknown>;
  safetyIdentifier?: string;
  hasPhoto?: boolean;
};

function userContentForVerdict(brief: string) {
  return [{ type: "input_text" as const, text: brief }];
}

export async function generateStylistVerdict({
  photoAnalysis,
  userReview,
  questionnaireAnswers,
  measurements,
  wardrobeInventory = {},
  applicationContext = {},
  safetyIdentifier,
  hasPhoto = false,
}: GenerateStylistVerdictInput): Promise<{
  verdict: StylistVerdict;
  tokens: PhotoUsageTokens | null;
}> {
  const review = parseStyleUserReview(userReview);
  const brief = buildFittingVerdictBrief({
    questionnaireAnswers,
    measurements,
    wardrobeInventory,
    applicationContext,
    photoAnalysis,
    userReview: review,
    hasPhoto,
  });

  logFitting("verdict.brief", {
    hasPhoto,
    brief,
    measurements: measurements ?? null,
  });
  const started = Date.now();
  const { value: raw, usage } = await callPhotoJsonSchema({
    model: stylistVerdictModel(),
    reasoning: { effort: "low" },
    instructions: FITTING_VERDICT_INSTRUCTIONS,
    userContent: userContentForVerdict(brief),
    format: {
      name: FITTING_VERDICT_SCHEMA_NAME,
      description: FITTING_VERDICT_SCHEMA_DESCRIPTION,
      schema: FITTING_VERDICT_SCHEMA,
    },
    maxOutputTokens: VERDICT_MAX_OUTPUT_TOKENS,
    timeoutMs: VERDICT_TIMEOUT_MS,
    safetyIdentifier,
    incompleteError: PHOTO_ERROR.verdict_incomplete,
  });
  let fitting = parseFittingVerdict(raw);
  if (!fitting) throw new Error(PHOTO_ERROR.non_json);
  const violations = validateStyleContract(fitting.contract, {
    hasPhoto,
    reading: fitting.reading,
  });
  logFitting("verdict.contract", {
    violations,
    contract: fitting.contract,
    reading: fitting.reading,
  });
  let tokens = usage;
  if (violations.length) {
    const repairLeft = VERDICT_TIMEOUT_MS - (Date.now() - started);
    logFitting("verdict.repair", {
      violations,
      remainingMs: repairLeft,
    });
    if (repairLeft >= 8_000) {
      try {
        const repaired = await callPhotoJsonSchema({
          model: stylistVerdictModel(),
          reasoning: { effort: "low" },
          instructions: FITTING_VERDICT_REPAIR_INSTRUCTIONS,
          userContent: [
            {
              type: "input_text",
              text: JSON.stringify({
                violations,
                output: raw,
              }),
            },
          ],
          format: {
            name: FITTING_VERDICT_SCHEMA_NAME,
            description: FITTING_VERDICT_SCHEMA_DESCRIPTION,
            schema: FITTING_VERDICT_SCHEMA,
          },
          maxOutputTokens: VERDICT_MAX_OUTPUT_TOKENS,
          timeoutMs: repairLeft,
          safetyIdentifier,
          incompleteError: PHOTO_ERROR.verdict_incomplete,
        });
        const next = parseFittingVerdict(repaired.value);
        if (next) fitting = next;
        if (repaired.usage && tokens) {
          tokens = {
            input_tokens:
              (tokens.input_tokens ?? 0) + (repaired.usage.input_tokens ?? 0),
            output_tokens:
              (tokens.output_tokens ?? 0) + (repaired.usage.output_tokens ?? 0),
            total_tokens:
              (tokens.total_tokens ?? 0) + (repaired.usage.total_tokens ?? 0),
            reasoning_tokens:
              (tokens.reasoning_tokens ?? 0) +
              (repaired.usage.reasoning_tokens ?? 0),
          };
        } else if (repaired.usage) {
          tokens = repaired.usage;
        }
      } catch (error) {
        logFitting("verdict.repair_failed", {
          error: error instanceof Error ? error.message : "repair failed",
          keptFirst: true,
        });
      }
    }
  }
  return { verdict: attachFittingVerdict(fitting), tokens };
}

export function hashedSafetyIdentifier(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}
