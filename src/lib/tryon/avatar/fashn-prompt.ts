import type { AvatarAttributes } from "../types";

/**
 * Versioned avatar prompt for FASHN face-to-model.
 * Bump when attribute→phrase maps or base-wardrobe / normalize rules change.
 */
export const TRYON_AVATAR_PROMPT_VERSION = "v4" as const;

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

const FIDELITY_RULE =
  "faithful to stated body attributes only — no beautification, slimming, or idealization beyond them";

/**
 * Replaceable studio base the try-on dress step expects.
 * Anything busier (street clothes, scarf, jacket) causes clothes-on-clothes.
 */
export const AVATAR_BASE_WARDROBE =
  "plain fitted white crewneck t-shirt and simple dark fitted trousers only — no jacket, no coat, no scarf, no hat, no jewelry, no bag, no logos, no busy patterns, no layered outfits";

/**
 * FASHN `edit` pass after face-to-model — strips leftover source-photo clothes
 * and accessories so the stored twin is always a clean try-on base.
 */
export const AVATAR_BASE_NORMALIZE_PROMPT =
  `Replace ALL clothing and accessories on this person with a ${AVATAR_BASE_WARDROBE}. ` +
  "Remove scarves, jackets, coats, hats, jewelry, bags, patterned tops, dresses, and any outfit copied from the source photo. " +
  "Keep the same face, hair, skin tone, body shape, and neutral standing pose with arms relaxed at sides. " +
  "Clean studio backdrop, soft even lighting. Do not change identity.";

/**
 * Compact body-shape prompt for FASHN face-to-model.
 * Face/hair/skin identity come from `face_image` — never restate them here.
 * Image generators consume visual descriptions, not centimeters.
 */
export function buildFashnAvatarPrompt(
  attributes: AvatarAttributes,
): string | undefined {
  const parts: string[] = [];

  if (attributes.build) {
    parts.push(
      {
        slim: "slender frame",
        average: "average build",
        broad: "broad solid frame",
        athletic: "athletic build",
        plus: "curvy fuller figure",
      }[attributes.build],
    );
  }

  if (attributes.body_shape) {
    parts.push(BODY_SHAPE_PHRASE[attributes.body_shape]);
  }

  if (attributes.bust_fullness) {
    parts.push(BUST_FULLNESS_PHRASE[attributes.bust_fullness]);
  }

  if (attributes.muscularity) {
    parts.push(
      {
        low: "soft physique",
        moderate: "lightly toned",
        high: "defined musculature",
      }[attributes.muscularity],
    );
  }

  if (attributes.height_band) {
    parts.push(
      {
        under_160: "petite stature",
        "160_170": "medium height",
        "170_180": "average height",
        "180_190": "tall stature",
        over_190: "very tall stature",
      }[attributes.height_band],
    );
  }

  // Pose + base wardrobe that dress try-on can replace cleanly.
  // face-to-model often copies scarves/jackets from the selfie — forbid that.
  parts.push("neutral standing pose, arms relaxed at sides");
  parts.push(`wearing a ${AVATAR_BASE_WARDROBE}`);
  parts.push(
    "do not keep any clothing, scarf, jacket, jewelry, or accessories from the face photo — generate a fresh studio outfit as specified",
  );
  parts.push(FIDELITY_RULE);

  return parts.length ? parts.join(", ") : undefined;
}
