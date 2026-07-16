import {
  FASHN_MODEL,
  TRYON_COST_ESTIMATES,
  TRYON_PROVIDER_RETRIES,
} from "../config";
import { buildOutfitCollagePrompt } from "../dress/outfit-collage";
import { buildTryonDressPromptCompact } from "../dress/prompt";
import { logTryonDress } from "../dress-log";
import { fetchImageBytes } from "./image-utils";
import { runFashnPrediction } from "./fashn-api";
import type { GarmentType } from "../types";
import type {
  AvatarProviderResult,
  TryOnProvider,
  TryOnProviderInput,
} from "./types";

const GARMENT_PROMPT: Record<GarmentType, string> = {
  top: "upper body garment",
  bottom: "lower body garment",
  shoes: "footwear",
  dress: "dress or one-piece outfit",
  outerwear: "outerwear jacket or coat",
};

/** tryon-v1.6 category — collage full looks use auto (multi-item image). */
function garmentCategory(
  type: GarmentType,
  outfitCollage?: TryOnProviderInput["outfitCollage"],
): string {
  if (outfitCollage && outfitCollage.titles.length > 1) return "auto";
  if (type === "dress") return "one-pieces";
  if (type === "bottom") return "bottoms";
  if (type === "outerwear" || type === "top") return "tops";
  return "auto";
}

async function toFashnImageRef(
  url: string,
  bytes?: Uint8Array,
  contentType = "image/jpeg",
): Promise<string> {
  if (url.startsWith("data:")) return url;
  const data = bytes ?? (await fetchImageBytes(url));
  const b64 = Buffer.from(data).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

export class FashnTryOnProvider implements TryOnProvider {
  readonly name: string;

  constructor() {
    this.name = FASHN_MODEL;
  }

  async dress(input: TryOnProviderInput): Promise<AvatarProviderResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= TRYON_PROVIDER_RETRIES; attempt++) {
      try {
        const useV16 = FASHN_MODEL === "tryon-v1.6";
        const modelImage = await toFashnImageRef(
          input.avatarUrl,
          input.avatarBytes,
          input.avatarContentType,
        );

        const isCollage = Boolean(
          input.outfitCollage && input.outfitCollage.titles.length > 1,
        );
        const prompt = isCollage
          ? buildOutfitCollagePrompt({
              titles: input.outfitCollage!.titles,
              types: input.outfitCollage!.types,
            })
          : input.product
            ? buildTryonDressPromptCompact(input.product, input.chain)
            : `Apply the ${GARMENT_PROMPT[input.garmentType]} naturally. Preserve fabric, color, pattern, and structure from the product image.`;

        const category = garmentCategory(input.garmentType, input.outfitCollage);

        const inputs = useV16
          ? {
              model_image: modelImage,
              garment_image: input.garmentImageUrl,
              category,
              garment_photo_type: "auto" as const,
            }
          : {
              model_image: modelImage,
              product_image: input.garmentImageUrl,
              prompt,
              resolution: "1k",
              // Outfit collage benefits from a bit more fidelity than single fast.
              generation_mode: isCollage ? "balanced" : "fast",
            };

        const started = Date.now();
        logTryonDress("info", "provider_api_call", {
          provider_key: "fashn",
          provider: FASHN_MODEL,
          garment_type: input.garmentType,
          category: useV16 ? category : undefined,
          outfit_collage: isCollage,
          collage_pieces: input.outfitCollage?.titles.length,
          has_product_context: Boolean(input.product),
          prompt_version: input.product?.prompt_version,
          prompt_chars: useV16 ? undefined : prompt.length,
          product_id: input.product?.product_id,
          selected_color: input.product?.selected_color,
          selected_size: input.product?.selected_size,
          material_notes: input.product?.material_notes?.length,
          style_notes: input.product?.style_notes?.length,
          fit_notes: input.product?.fit_notes?.length,
          chain_step:
            !isCollage && input.chain != null
              ? `${input.chain.stepIndex + 1}/${input.chain.stepTotal}`
              : undefined,
        });
        const imageUrl = await runFashnPrediction({
          modelName: FASHN_MODEL,
          inputs,
        });
        logTryonDress("info", "provider_api_done", {
          provider_key: "fashn",
          provider: FASHN_MODEL,
          latency_ms: Date.now() - started,
          outfit_collage: isCollage,
        });
        return { imageUrl };
      } catch (error) {
        lastError = error;
        logTryonDress("warn", "provider_api_retry", {
          provider_key: "fashn",
          provider: FASHN_MODEL,
          attempt,
          error: String(error).slice(0, 300),
        });
        if (attempt >= TRYON_PROVIDER_RETRIES) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export function fashnCostEstimate(): number {
  return FASHN_MODEL === "tryon-v1.6"
    ? TRYON_COST_ESTIMATES.fashn_tryon_v16
    : TRYON_COST_ESTIMATES.fashn_tryon_max_1k;
}
