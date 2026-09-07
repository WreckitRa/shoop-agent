import { callPhotoJsonSchema } from "@/lib/photo-analysis/openai";
import { photoPreflightModel } from "@/lib/photo-analysis/analyze";
import type { ContractPiece } from "@/lib/photo-analysis/style-contract";
import type { GarmentImageOk } from "./garment-image";

export type JudgePick = {
  candidateIndex: number;
  garmentImageIndex: number;
  garmentPhotoType: "flat-lay" | "model";
  observedColor: string;
  reason: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "piece_index",
          "candidate_index",
          "garment_image_index",
          "garment_photo_type",
          "observed_color",
          "reason",
        ],
        properties: {
          piece_index: { type: "integer" },
          candidate_index: { type: "integer" },
          garment_image_index: { type: "integer" },
          garment_photo_type: { type: "string", enum: ["flat-lay", "model"] },
          observed_color: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export type JudgePieceInput = {
  piece: ContractPiece;
  candidates: GarmentImageOk[];
};

function candidateText(c: GarmentImageOk, i: number): string {
  const attrs = c.product.metadata?.attributes;
  return [
    `#${i}`,
    c.product.title,
    c.matchedColorLabel ? `color option: ${c.matchedColorLabel}` : "no Color option",
    `observed pixels: ${c.observedFamily}`,
    attrs ? `attrs: ${JSON.stringify(attrs).slice(0, 240)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

export async function judgeLook(input: {
  lookName: string;
  pieces: JudgePieceInput[];
}): Promise<Array<JudgePick | null>> {
  const pieces = input.pieces.map((row) => ({
    ...row,
    candidates: row.candidates.slice(0, 4),
  }));
  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "low" }
  > = [
    {
      type: "input_text",
      text: JSON.stringify({
        look: input.lookName,
        instruction:
          "For each piece pick the candidate that IS that garment type, in that colour family, with that fit, and none of the must_not terms. Also pick garment_image_index: prefer a flat-lay or ghost-mannequin shot; if only on-model shots exist, pick the one where the garment is fully visible with the least other clothing. Return garment_photo_type for the chosen image. candidate_index -1 if no candidate qualifies.",
        pieces: pieces.map((row, pi) => ({
          piece_index: pi,
          spec: row.piece,
          candidates: row.candidates.map((c, ci) => candidateText(c, ci)),
        })),
      }),
    },
  ];
  for (const row of pieces) {
    for (const c of row.candidates) {
      for (const url of c.garmentImageUrls.slice(0, 3)) {
        userContent.push({ type: "input_image", image_url: url, detail: "low" });
      }
    }
  }

  const { value } = await callPhotoJsonSchema({
    model: photoPreflightModel(),
    reasoning: { effort: "none" },
    instructions:
      "You are Luna, a merch picker. Only pick a product that matches garment type, colour family, and fit. Never pick a wrong category or an off-palette colourway. Prefer flat-lay / ghost shots.",
    userContent,
    format: {
      name: "look_judge",
      description: "One pick per look piece.",
      schema: SCHEMA,
    },
    maxOutputTokens: 1_200,
    timeoutMs: 20_000,
  });

  const picks = Array.isArray((value as { picks?: unknown }).picks)
    ? ((value as { picks: Array<Record<string, unknown>> }).picks)
    : [];
  return pieces.map((row, pi) => {
    const raw = picks.find((p) => Number(p.piece_index) === pi) ?? picks[pi];
    const idx = raw ? Number(raw.candidate_index) : 0;
    if (!Number.isInteger(idx) || idx < 0 || idx >= row.candidates.length) return null;
    const img = Number(raw?.garment_image_index ?? 0);
    const photoType = raw?.garment_photo_type === "flat-lay" ? "flat-lay" : "model";
    return {
      candidateIndex: idx,
      garmentImageIndex: Number.isInteger(img) && img >= 0 ? img : 0,
      garmentPhotoType: photoType,
      observedColor: String(raw?.observed_color ?? row.candidates[idx]!.observedFamily),
      reason: String(raw?.reason ?? ""),
    };
  });
}
