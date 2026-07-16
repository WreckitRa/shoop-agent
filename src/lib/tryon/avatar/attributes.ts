import type { AvatarAttributes } from "../types";

/** Required for generate on every path (Quick + Tailored). */
const SILHOUETTE_KEYS = ["height_band", "build", "muscularity"] as const;

export type SilhouetteAttributeKey = (typeof SILHOUETTE_KEYS)[number];

export function missingSilhouetteAttributes(
  attributes: Partial<AvatarAttributes> | undefined,
): SilhouetteAttributeKey[] {
  if (!attributes) return [...SILHOUETTE_KEYS];
  return SILHOUETTE_KEYS.filter((key) => !attributes[key]);
}

export function hasRequiredSilhouetteAttributes(
  attributes: Partial<AvatarAttributes> | undefined,
): attributes is Pick<AvatarAttributes, SilhouetteAttributeKey> {
  return missingSilhouetteAttributes(attributes).length === 0;
}

/** Drop legacy face fields — FASHN takes those from the photo. */
export function silhouetteOnlyAttributes(
  attributes: Partial<AvatarAttributes> & Record<string, unknown>,
): AvatarAttributes {
  const out: AvatarAttributes = {};
  if (typeof attributes.height_band === "string") {
    out.height_band = attributes.height_band as AvatarAttributes["height_band"];
  }
  if (typeof attributes.build === "string") {
    out.build = attributes.build as AvatarAttributes["build"];
  }
  if (typeof attributes.muscularity === "string") {
    out.muscularity =
      attributes.muscularity as AvatarAttributes["muscularity"];
  }
  if (typeof attributes.body_shape === "string") {
    out.body_shape = attributes.body_shape as AvatarAttributes["body_shape"];
  }
  if (typeof attributes.bust_fullness === "string") {
    out.bust_fullness =
      attributes.bust_fullness as AvatarAttributes["bust_fullness"];
  }
  return out;
}

export const SILHOUETTE_LABELS: Record<SilhouetteAttributeKey, string> = {
  height_band: "Height",
  build: "Build",
  muscularity: "Musculature",
};

export const BODY_SHAPE_LABELS: Record<
  NonNullable<AvatarAttributes["body_shape"]>,
  string
> = {
  rectangle: "Rectangle",
  triangle: "Triangle (fuller hips)",
  inverted_triangle: "Inverted triangle (broader shoulders)",
  hourglass: "Hourglass",
  oval: "Oval (fuller middle)",
};

export const BUST_FULLNESS_LABELS: Record<
  NonNullable<AvatarAttributes["bust_fullness"]>,
  string
> = {
  subtle: "Subtle",
  average: "Average",
  full: "Full",
  very_full: "Very full",
};
