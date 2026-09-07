import type { AvatarAttributes } from "../types";

/**
 * Versioned avatar prompt for FASHN face-to-model.
 * Bump when attribute→phrase maps or base-wardrobe / normalize rules change.
 */
export const TRYON_AVATAR_PROMPT_VERSION = "v6" as const;

const BUILD_PHRASE: Record<NonNullable<AvatarAttributes["build"]>, string> = {
  slim: "slender frame, narrow shoulders and chest",
  average: "average build",
  athletic: "athletic build, wide shoulders, narrow waist",
  broad: "broad solid frame, wide shoulders",
  plus: "curvy fuller figure",
};

const BODY_SHAPE_PHRASE: Record<
  NonNullable<AvatarAttributes["body_shape"]>,
  string
> = {
  rectangle: "balanced proportions",
  triangle: "fuller hips relative to shoulders",
  inverted_triangle: "broader shoulders, narrower hips",
  hourglass: "defined waist with proportionate bust and hips",
  oval: "fuller midsection",
};

const BUST_FULLNESS_PHRASE: Record<
  NonNullable<AvatarAttributes["bust_fullness"]>,
  string
> = {
  subtle: "subtle bust",
  average: "average bust fullness",
  full: "full bust",
  very_full: "very full bust",
};

const MUSCLE_PHRASE: Record<
  NonNullable<AvatarAttributes["muscularity"]>,
  string
> = {
  low: "soft physique",
  moderate: "lightly toned",
  high: "defined musculature",
};

const HEIGHT_PHRASE: Record<
  NonNullable<AvatarAttributes["height_band"]>,
  string
> = {
  under_160: "petite stature",
  "160_170": "medium height",
  "170_180": "average height",
  "180_190": "tall stature",
  over_190: "very tall stature",
};

/**
 * Replaceable studio base the try-on dress step expects.
 * Anything busier (street clothes, scarf, jacket) causes clothes-on-clothes.
 */
export const AVATAR_BASE_WARDROBE =
  "plain mid-grey fitted crewneck t-shirt and dark grey fitted trousers only, plain light backdrop — no jacket, no coat, no scarf, no hat, no jewelry, no bag, no logos, no busy patterns, no layered outfits, not white";

/** Stated silhouette only — FASHN infers body from the face unless we say otherwise. */
export function buildFashnBodyGuidance(attributes: AvatarAttributes): string {
  const parts: string[] = [];
  if (attributes.build) parts.push(BUILD_PHRASE[attributes.build]);
  if (attributes.body_shape) parts.push(BODY_SHAPE_PHRASE[attributes.body_shape]);
  if (attributes.bust_fullness) {
    parts.push(BUST_FULLNESS_PHRASE[attributes.bust_fullness]);
  }
  if (attributes.muscularity) parts.push(MUSCLE_PHRASE[attributes.muscularity]);
  if (attributes.height_band) parts.push(HEIGHT_PHRASE[attributes.height_band]);
  return parts.join(", ");
}

/**
 * FASHN face-to-model `prompt` is body/styling guidance, not a clothing essay.
 * Docs examples: "athletic build", "curvy figure", "slender frame".
 * Face/hair/skin come from `face_image`.
 */
export function buildFashnAvatarPrompt(
  attributes: AvatarAttributes,
): string | undefined {
  const body = buildFashnBodyGuidance(attributes);
  if (!body) return undefined;
  return [
    body,
    "Do not infer body type from the face",
    "neutral standing pose, arms relaxed at sides",
    "plain fitted mid-grey crewneck t-shirt",
  ].join(". ");
}

/**
 * FASHN `edit` pass after face-to-model.
 * Must restate body — "keep the same body shape" would lock in the selfie-inferred figure.
 */
export function buildFashnNormalizePrompt(attributes: AvatarAttributes): string {
  const body = buildFashnBodyGuidance(attributes);
  const reshape = body
    ? `Reshape the body to match: ${body}. Do not keep the body inferred from the source photo. `
    : "";
  return (
    reshape +
    `Replace ALL clothing and accessories on this person with a ${AVATAR_BASE_WARDROBE}. ` +
    "Remove scarves, jackets, coats, hats, jewelry, bags, patterned tops, dresses, and any outfit copied from the source photo. " +
    "Keep the same face, hair, and skin tone. Neutral standing pose with arms relaxed at sides. " +
    "Clean studio backdrop, soft even lighting. Do not change identity."
  );
}
