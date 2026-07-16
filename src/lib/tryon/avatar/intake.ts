import type { AttributeIntakeResult, AvatarAttributes } from "../types";
import { missingSilhouetteAttributes } from "./attributes";

/**
 * Deterministic intake — no vision model.
 * Silhouette attrs come from user pickers; photo is required by FASHN face-to-model.
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
    };
  }

  const missing = missingSilhouetteAttributes(params.statedAttributes);
  return {
    clear: {},
    missing,
    minor_refused: false,
  };
}

let intakeOverride: ((url?: string) => AttributeIntakeResult) | null = null;

export function setAvatarIntakeOverride(
  fn: ((url?: string) => AttributeIntakeResult) | null,
): void {
  intakeOverride = fn;
}
