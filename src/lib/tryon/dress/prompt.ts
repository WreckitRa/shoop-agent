import type { GarmentType } from "../types";
import type { TryonProductContext } from "./product-context";

export const TRYON_DRESS_PROMPT_VERSION = "v3" as const;

const PLACEMENT: Record<GarmentType, string> = {
  top: "Place on the upper body only — match neckline, sleeve length, hem, and shoulder seams from the product reference.",
  bottom:
    "Place on the lower body only — match waist rise, inseam, leg opening, and hip/thigh fit from the product reference.",
  shoes:
    "Place on both feet — match sole thickness, toe shape, and ankle coverage; ground contact must look natural.",
  dress:
    "Dress as one continuous garment over torso and skirt/pant — preserve waist seam and silhouette from the product reference.",
  outerwear:
    "Layer as outerwear over the current outfit — match collar/lapel, closure, length, and sleeve volume without erasing layers underneath.",
};

const FIDELITY =
  "Preserve exact color, fabric texture, pattern/print, logos, hardware, and garment structure from the product image. Do not invent details or recolor the garment.";

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
      parts.push(
        `Outfit base layer (step 1 of ${chain.stepTotal}): establish this garment; later steps will add more pieces on top of this result.`,
      );
    } else {
      const prior =
        chain.priorGarmentTitles?.filter(Boolean).slice(0, 6).join("; ") ||
        "all previously applied garments";
      parts.push(
        `CRITICAL multi-garment try-on step ${chain.stepIndex + 1} of ${chain.stepTotal}: the model_image already shows the person wearing ${prior}. ADD only this new ${product.garment_type}. Do NOT remove, replace, recolor, or cover previously worn garments. Keep prior layers fully visible and unchanged except where this new piece naturally overlaps.`,
      );
    }
  }

  // FASHN prompts stay concise — soft cap ~900 chars.
  const prompt = parts.join(" ");
  return prompt.length > 900 ? `${prompt.slice(0, 897)}...` : prompt;
}
