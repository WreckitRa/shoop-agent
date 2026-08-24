import { jpegDataUrlLow, jpegDataUrlOriginal } from "./decode";
import { PHOTO_ERROR } from "./errors";
import { callPhotoJsonSchema, withPhotoGptLock } from "./openai";
import {
  STYLE_PHOTO_ANALYSIS_INSTRUCTIONS,
  STYLE_PHOTO_ANALYSIS_SCHEMA,
  STYLE_PHOTO_ANALYSIS_SCHEMA_DESCRIPTION,
  STYLE_PHOTO_ANALYSIS_SCHEMA_NAME,
  STYLE_PHOTO_PREFLIGHT_INSTRUCTIONS,
  STYLE_PHOTO_PREFLIGHT_SCHEMA,
  STYLE_PHOTO_PREFLIGHT_SCHEMA_DESCRIPTION,
  STYLE_PHOTO_PREFLIGHT_SCHEMA_NAME,
} from "./prompt";
import {
  EMPTY_IMAGE_PREFLIGHT,
  parseStylePhotoAnalysis,
  parseStylePhotoPreflight,
  shouldRunDetailedAnalysis,
  type PhotoCoverage,
  type StylePhotoAnalysis,
  type StylePhotoPreflight,
} from "./result";

export const DEFAULT_STYLE_PHOTO_MODEL = "gpt-5.6-terra";
export const DEFAULT_STYLE_PHOTO_PREFLIGHT_MODEL = "gpt-5.6-luna";
const ANALYSIS_TIMEOUT_MS = 170_000;
const PREFLIGHT_TIMEOUT_MS = 25_000;
const ANALYSIS_MAX_OUTPUT_TOKENS = 10_000;
const PREFLIGHT_MAX_OUTPUT_TOKENS = 350;

export function photoAnalysisModel(): string {
  const override = process.env.OPENAI_PHOTO_ANALYSIS_MODEL?.trim();
  return override || DEFAULT_STYLE_PHOTO_MODEL;
}

export function photoPreflightModel(): string {
  const override = process.env.OPENAI_PHOTO_PREFLIGHT_MODEL?.trim();
  return override || DEFAULT_STYLE_PHOTO_PREFLIGHT_MODEL;
}

export type StylePhotoPreflightInput = {
  imageUrls: string[];
  targetPerson: string;
  requestedCoverage?: PhotoCoverage;
  allowPartialAnalysis?: boolean;
};

export type StylePhotoAnalyzerInput = {
  imageUrls: string[];
  targetPerson: string;
  requestedCoverage?: PhotoCoverage;
  declaredContext?: Record<string, unknown>;
};

export async function preflightStylePhotos({
  imageUrls,
  targetPerson,
  requestedCoverage = "full_body",
  allowPartialAnalysis = false,
}: StylePhotoPreflightInput): Promise<StylePhotoPreflight> {
  if (imageUrls.length === 0) {
    return {
      ...EMPTY_IMAGE_PREFLIGHT,
      requested_coverage: requestedCoverage,
    };
  }

  return withPhotoGptLock(async () => {
    const raw = await callPhotoJsonSchema({
      model: photoPreflightModel(),
      reasoning: { effort: "none" },
      instructions: STYLE_PHOTO_PREFLIGHT_INSTRUCTIONS,
      userContent: [
        {
          type: "input_text",
          text: JSON.stringify({
            target_person: targetPerson,
            requested_coverage: requestedCoverage,
            allow_partial_analysis: allowPartialAnalysis,
          }),
        },
        ...imageUrls.map((image_url) => ({
          type: "input_image" as const,
          image_url,
          detail: "low" as const,
        })),
      ],
      format: {
        name: STYLE_PHOTO_PREFLIGHT_SCHEMA_NAME,
        description: STYLE_PHOTO_PREFLIGHT_SCHEMA_DESCRIPTION,
        schema: STYLE_PHOTO_PREFLIGHT_SCHEMA,
      },
      maxOutputTokens: PREFLIGHT_MAX_OUTPUT_TOKENS,
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    });
    const gate = parseStylePhotoPreflight(raw);
    if (!gate) throw new Error(PHOTO_ERROR.non_json);
    return gate;
  });
}

export async function analyzeStylePhotos({
  imageUrls,
  targetPerson,
  requestedCoverage = "full_body",
  declaredContext = {},
}: StylePhotoAnalyzerInput): Promise<StylePhotoAnalysis> {
  if (imageUrls.length === 0) {
    throw new Error("At least one image is required.");
  }

  const userPayload = {
    task: "Create the photo-derived portion of this person's professional style profile.",
    target_person: targetPerson,
    requested_coverage: requestedCoverage,
    declared_context: declaredContext,
    instruction:
      "Use declared_context as user-supplied facts. Do not claim those facts were visually verified. Analyze every supplied image together and return the strict schema.",
  };

  return withPhotoGptLock(async () => {
    const raw = await callPhotoJsonSchema({
      model: photoAnalysisModel(),
      reasoning: { effort: "medium" },
      instructions: STYLE_PHOTO_ANALYSIS_INSTRUCTIONS,
      userContent: [
        { type: "input_text", text: JSON.stringify(userPayload) },
        ...imageUrls.map((image_url) => ({
          type: "input_image" as const,
          image_url,
          detail: "original" as const,
        })),
      ],
      format: {
        name: STYLE_PHOTO_ANALYSIS_SCHEMA_NAME,
        description: STYLE_PHOTO_ANALYSIS_SCHEMA_DESCRIPTION,
        schema: STYLE_PHOTO_ANALYSIS_SCHEMA,
      },
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
    });
    const result = parseStylePhotoAnalysis(raw);
    if (!result) throw new Error(PHOTO_ERROR.non_json);
    return result;
  });
}

/**
 * Pay for Terra only after Luna accepts the selected coverage path.
 * Onboarding does not auto-downgrade (allowPartialAnalysis stays off).
 */
export async function preflightThenAnalyzeStylePhotos(
  input: StylePhotoAnalyzerInput & {
    allowPartialAnalysis?: boolean;
  },
): Promise<{ gate: StylePhotoPreflight; analysis: StylePhotoAnalysis | null }> {
  const allowPartial = input.allowPartialAnalysis ?? false;
  const requestedCoverage = input.requestedCoverage ?? "full_body";
  const gate = await preflightStylePhotos({
    imageUrls: input.imageUrls,
    targetPerson: input.targetPerson,
    requestedCoverage,
    allowPartialAnalysis: allowPartial,
  });

  if (!shouldRunDetailedAnalysis(gate, allowPartial)) {
    return { gate, analysis: null };
  }

  const analysis = await analyzeStylePhotos(input);
  return { gate, analysis };
}

export async function preflightThenAnalyzeFromBytes(
  bytes: Buffer,
  opts: {
    targetPerson: string;
    declaredContext?: Record<string, unknown>;
    requestedCoverage?: PhotoCoverage;
    allowPartialAnalysis?: boolean;
  },
): Promise<{ gate: StylePhotoPreflight; analysis: StylePhotoAnalysis | null }> {
  const lowUrl = await jpegDataUrlLow(bytes);
  const allowPartial = opts.allowPartialAnalysis ?? false;
  const requestedCoverage = opts.requestedCoverage ?? "full_body";
  const gate = await preflightStylePhotos({
    imageUrls: [lowUrl],
    targetPerson: opts.targetPerson,
    requestedCoverage,
    allowPartialAnalysis: allowPartial,
  });

  if (!shouldRunDetailedAnalysis(gate, allowPartial)) {
    return { gate, analysis: null };
  }

  const analysis = await analyzeStylePhotos({
    imageUrls: [await jpegDataUrlOriginal(bytes)],
    targetPerson: opts.targetPerson,
    requestedCoverage,
    declaredContext: opts.declaredContext,
  });
  return { gate, analysis };
}
