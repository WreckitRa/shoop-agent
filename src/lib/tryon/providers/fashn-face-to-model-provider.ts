import { logAiChat } from "@/lib/ai-chat/observability";
import { buildFashnAvatarPrompt } from "../avatar/fashn-prompt";
import { TRYON_COST_ESTIMATES } from "../config";
import { fetchImageBytes } from "./image-utils";
import { runFashnPrediction } from "./fashn-api";
import type {
  AvatarProvider,
  AvatarProviderInput,
  AvatarProviderResult,
} from "./types";

const FACE_TO_MODEL = "face-to-model";

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

/** FASHN face-to-model — requires a face photo; upper-body try-on avatar. */
export class FashnFaceToModelAvatarProvider implements AvatarProvider {
  readonly name = FACE_TO_MODEL;

  async createAvatar(input: AvatarProviderInput): Promise<AvatarProviderResult> {
    if (!input.photoUrl && !input.photoBytes) {
      throw new Error("FASHN face-to-model requires a photo");
    }

    const started = Date.now();
    const faceImage = await toFashnImageRef(
      input.photoUrl ?? "data:image/jpeg;base64,",
      input.photoBytes,
      input.photoContentType,
    );

    const prompt = buildFashnAvatarPrompt(input.attributes);
    // Random seed each run so "Regenerate" actually varies.
    const seed = Math.floor(Math.random() * 2_147_483_647);

    const imageUrl = await runFashnPrediction({
      modelName: FACE_TO_MODEL,
      inputs: {
        face_image: faceImage,
        ...(prompt ? { prompt } : {}),
        aspect_ratio: "2:3",
        // quality + 1k ≈ best look / cost for try-on avatars (docs: ~3 credits, ~30–55s).
        resolution: "1k",
        generation_mode: "quality",
        output_format: "png",
        seed,
      },
    });

    logAiChat("info", "avatar_fashn_face_to_model_complete", {
      latency_ms: Date.now() - started,
      has_prompt: Boolean(prompt),
      seed,
    });

    return { imageUrl, contentType: "image/png" };
  }
}

export function fashnFaceToModelCostEstimate(): number {
  return TRYON_COST_ESTIMATES.fashn_face_to_model;
}
