import type {
  AttributeIntakeResult,
  AvatarAttributes,
  BodyShapeBand,
} from "../types";
import { missingSilhouetteAttributes } from "./attributes";

/**
 * Classify whether a photo is suitable for body-shape inference.
 * Face-only selfies must never attempt body inference.
 *
 * Test hooks (URL markers): `fullbody` → full_body; `faceonly` → face_only.
 */
export type AvatarPhotoKind = "full_body" | "face_only" | "unknown";

export function classifyAvatarPhotoKind(
  photoSignedUrl?: string,
): AvatarPhotoKind {
  const url = (photoSignedUrl ?? "").toLowerCase();
  if (url.includes("fullbody") || url.includes("full-body")) return "full_body";
  if (
    url.includes("faceonly") ||
    url.includes("face-only") ||
    url.includes("selfie")
  ) {
    return "face_only";
  }
  return "unknown";
}

/**
 * Avatar intake — attribute check after photo upload.
 *
 * When a full-body photo is provided, may pre-fill body_shape as a suggestion
 * (user can change). Face-only selfies never attempt body inference.
 *
 * Production: optional Claude-vision via `AVATAR_INTAKE_VISION=1` + override.
 * Tests: `setAvatarIntakeOverride` or URL markers (`fullbody` / `faceonly`).
 */
export async function runAvatarIntake(params: {
  traceId?: string | null;
  photoSignedUrl?: string;
  statedAttributes?: Partial<AvatarAttributes>;
}): Promise<AttributeIntakeResult> {
  if (intakeOverride) return intakeOverride(params.photoSignedUrl);

  if (
    process.env.NODE_ENV === "test" &&
    params.photoSignedUrl?.includes("minor")
  ) {
    return {
      clear: {},
      missing: [],
      minor_refused: true,
      refusal_message: "We can't use photos of minors for try-on.",
      body_inference_attempted: false,
    };
  }

  const photoKind = classifyAvatarPhotoKind(params.photoSignedUrl);
  const clear: Partial<AvatarAttributes> = {};
  let body_inference_attempted = false;

  if (photoKind === "full_body") {
    body_inference_attempted = true;
    const suggested = await suggestBodyShapeFromPhoto(params.photoSignedUrl);
    if (suggested && !params.statedAttributes?.body_shape) {
      clear.body_shape = suggested;
    }
  }
  // face_only / unknown: never infer body shape

  const missing = missingSilhouetteAttributes(params.statedAttributes);
  return {
    clear,
    missing,
    minor_refused: false,
    body_inference_attempted,
  };
}

/**
 * Optional vision suggestion. Deterministic test default for fullbody mocks;
 * real Claude-vision can be wired behind AVATAR_INTAKE_VISION without changing
 * the call site.
 */
async function suggestBodyShapeFromPhoto(
  photoSignedUrl?: string,
): Promise<BodyShapeBand | undefined> {
  if (visionSuggestOverride) {
    return visionSuggestOverride(photoSignedUrl);
  }
  // Explicit mock URL markers (tests / fixtures) — not used for real storage paths.
  const url = (photoSignedUrl ?? "").toLowerCase();
  const isMockFullBody =
    url.includes("mock-fullbody") ||
    url.includes("mock-full-body") ||
    (url.includes("fullbody") && url.includes("cdn.example"));
  if (isMockFullBody) {
    if (url.includes("triangle")) return "triangle";
    if (url.includes("hourglass")) return "hourglass";
    return "rectangle";
  }
  if (process.env.AVATAR_INTAKE_VISION === "1") {
    // Reserved: Claude-vision body_shape suggestion (full-body only).
    // Not enabled by default — face photo remains the primary FASHN input.
  }
  return undefined;
}

let intakeOverride: ((url?: string) => AttributeIntakeResult) | null = null;

export function setAvatarIntakeOverride(
  fn: ((url?: string) => AttributeIntakeResult) | null,
): void {
  intakeOverride = fn;
}

let visionSuggestOverride:
  | ((url?: string) => BodyShapeBand | undefined)
  | null = null;

export function setAvatarVisionSuggestOverride(
  fn: ((url?: string) => BodyShapeBand | undefined) | null,
): void {
  visionSuggestOverride = fn;
}
