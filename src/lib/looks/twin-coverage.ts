import { callPhotoJsonSchema } from "@/lib/photo-analysis/openai";
import { photoPreflightModel } from "@/lib/photo-analysis/analyze";
import type { TwinCoverage } from "@/lib/tryon/types";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["coverage"],
  properties: {
    coverage: { type: "string", enum: ["full", "upper"] },
  },
} as const;

export async function assessTwinCoverage(imageUrl: string): Promise<TwinCoverage> {
  const { value } = await callPhotoJsonSchema({
    model: photoPreflightModel(),
    reasoning: { effort: "none" },
    instructions:
      "The image is a fashion avatar. coverage=full if face, torso, knees, and feet are visible. coverage=upper if cropped above the knees or feet are missing.",
    userContent: [
      { type: "input_text", text: "Classify twin_coverage." },
      { type: "input_image", image_url: imageUrl, detail: "low" },
    ],
    format: {
      name: "twin_coverage",
      description: "Avatar crop coverage.",
      schema: SCHEMA,
    },
    maxOutputTokens: 200,
    timeoutMs: 15_000,
  });
  return (value as { coverage?: string }).coverage === "upper" ? "upper" : "full";
}
