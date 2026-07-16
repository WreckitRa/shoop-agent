import type { AvatarAttributes } from "../types";

/**
 * Compact body-shape prompt for FASHN face-to-model.
 * Face/hair/skin identity come from `face_image` — never restate them here.
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

  // Pose that dress try-on can use cleanly.
  parts.push("neutral standing pose, arms relaxed at sides");

  return parts.length ? parts.join(", ") : undefined;
}
