import type { GarmentType } from "../types";
import type { TryonProductContext } from "./product-context";

export const TRYON_DRESS_PROMPT_VERSION = "v5" as const;

const PLACEMENT: Record<GarmentType, string> = {
  top: "REPLACE the existing upper-body clothing completely with this product — do not layer it on top of the current shirt/top. Match neckline, sleeve length, hem, and shoulder seams from the product reference.",
  bottom:
    "REPLACE the existing lower-body clothing completely with this product — do not layer it on top of the current pants/skirt. Match waist rise, inseam, leg opening, and hip/thigh fit from the product reference.",
  shoes:
    "Place on both feet — match sole thickness, toe shape, and ankle coverage; ground contact must look natural.",
  dress:
    "REPLACE the full current outfit with this one-piece — remove the existing top and bottom, then dress as one continuous garment. Preserve waist seam and silhouette from the product reference.",
  outerwear:
    "Layer as outerwear over the current outfit — match collar/lapel, closure, length, and sleeve volume without erasing layers underneath.",
};

const FIDELITY =
  "Preserve exact color, fabric texture, pattern/print, logos, hardware, and garment structure from the product image. Do not invent details or recolor the garment.";

const AVATAR_BASE_HINT =
  "Avatar base is a plain mid-grey tee + dark grey trousers — REPLACE that base in this region; do not leave it visible under the product.";

function firstLines(lines: string[], n: number): string[] {
  return lines.filter(Boolean).slice(0, n);
}

/**
 * Fidelity-first prompt for FASHN tryon-max.
 * Identity/pose come from model_image — do not describe the person.
 */
export function buildTryonDressPromptCompact(
  product: TryonProductContext,
  chain?: {
    stepIndex: number;
    stepTotal: number;
    priorGarmentTitles?: string[];
  },
): string {
  const identity = [
    product.title,
    product.brand ? `by ${product.brand}` : null,
    product.garment_type,
    product.taxonomy_category ? `(${product.taxonomy_category})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const colorBits = [
    product.selected_color ? `wear in ${product.selected_color}` : null,
    product.normalized_colors?.length
      ? `color family ${product.normalized_colors.join("/")}`
      : null,
    product.corrected_color &&
    product.corrected_color !== product.selected_color
      ? `listing photo reads as ${product.corrected_color}`
      : null,
  ].filter(Boolean);

  const fitBits = [
    product.selected_size ? `buyer size ${product.selected_size}` : null,
    product.size_fit_modifier
      ? `${product.size_fit_modifier} fit`
      : null,
    ...firstLines(product.fit_notes, 3),
  ].filter(Boolean);

  const textureBits = firstLines(
    [...product.material_notes, ...product.style_notes],
    6,
  );

  const parts: string[] = [
    `Apply this ${product.garment_type} to the person: ${identity}.`,
    colorBits.length ? `Color: ${colorBits.join("; ")}.` : null,
    textureBits.length ? `Construction/materials: ${textureBits.join("; ")}.` : null,
    fitBits.length ? `Fit cues: ${fitBits.join("; ")}.` : null,
    product.description
      ? `Product notes: ${product.description.slice(0, 280)}.`
      : null,
    PLACEMENT[product.garment_type],
    FIDELITY,
  ].filter(Boolean) as string[];

  if (chain && chain.stepTotal > 1) {
    if (chain.stepIndex === 0) {
      parts.push(AVATAR_BASE_HINT);
      parts.push(
        `Outfit base layer (step 1 of ${chain.stepTotal}): REPLACE whatever the person currently wears in this region with this garment; later steps will add more pieces on top of this result.`,
      );
    } else if (
      product.garment_type === "outerwear" ||
      product.garment_type === "shoes"
    ) {
      const prior =
        chain.priorGarmentTitles?.filter(Boolean).slice(0, 6).join("; ") ||
        "all previously applied garments";
      parts.push(
        `CRITICAL multi-garment try-on step ${chain.stepIndex + 1} of ${chain.stepTotal}: the model_image already shows the person wearing ${prior}. ADD only this new ${product.garment_type}. Do NOT remove, replace, recolor, or cover previously worn garments. Keep prior layers fully visible and unchanged except where this new piece naturally overlaps.`,
      );
    } else {
      // Same-region replace mid-chain (e.g. swap a top while keeping prior bottom).
      const prior =
        chain.priorGarmentTitles?.filter(Boolean).slice(0, 6).join("; ") ||
        "previously applied garments";
      parts.push(
        `CRITICAL multi-garment try-on step ${chain.stepIndex + 1} of ${chain.stepTotal}: REPLACE only the ${product.garment_type} region with this product. Keep other garments (${prior}) fully visible and unchanged.`,
      );
    }
  } else if (
    product.garment_type === "top" ||
    product.garment_type === "bottom" ||
    product.garment_type === "dress"
  ) {
    parts.push(AVATAR_BASE_HINT);
  }

  // FASHN prompts stay concise — soft cap ~900 chars.
  const prompt = parts.join(" ");
  return prompt.length > 900 ? `${prompt.slice(0, 897)}...` : prompt;
}
