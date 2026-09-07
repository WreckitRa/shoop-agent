import { callPhotoJsonSchema } from "@/lib/photo-analysis/openai";
import { photoPreflightModel } from "@/lib/photo-analysis/analyze";
import type { ColorFamily, ContractPiece, Slot } from "@/lib/photo-analysis/style-contract";
import { familiesCompatible } from "./image-color";

export type VerifyPiece = {
  slot: Slot;
  family: ColorFamily;
  present: boolean;
  observedFamily: ColorFamily | null;
  matches: boolean;
};

export type VerifyResult = {
  pass: boolean;
  pieces: VerifyPiece[];
  artifacts: string[];
  baseTeeVisible: boolean;
  faceChanged: boolean;
  extraLimb: boolean;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pieces", "artifacts", "pass", "base_tee_visible", "face_changed", "extra_limb"],
  properties: {
    pass: { type: "boolean" },
    base_tee_visible: { type: "boolean" },
    face_changed: { type: "boolean" },
    extra_limb: { type: "boolean" },
    artifacts: { type: "array", items: { type: "string" } },
    pieces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "present", "observed_family", "matches"],
        properties: {
          slot: { type: "string" },
          present: { type: "boolean" },
          observed_family: { type: "string" },
          matches: { type: "boolean" },
        },
      },
    },
  },
} as const;

const SLOTS: Slot[] = ["top", "bottom", "outerwear", "shoes", "one_piece"];

function asSlot(raw: string): Slot | null {
  return (SLOTS as string[]).includes(raw) ? (raw as Slot) : null;
}

export async function verifyLookRender(input: {
  renderUrl: string;
  pieces: Array<{ slot: Slot; spec: ContractPiece }>;
}): Promise<VerifyResult> {
  const { value } = await callPhotoJsonSchema({
    model: photoPreflightModel(),
    reasoning: { effort: "none" },
    instructions:
      "You check a virtual try-on. The base avatar wears a plain mid-grey crewneck tee and dark grey trousers. If the top region still shows that plain base tee, report top.present=false. Compare each dressed piece to its spec colour family. Flag face changes and extra limbs.",
    userContent: [
      {
        type: "input_text",
        text: JSON.stringify({
          pieces: input.pieces.map((p) => ({
            slot: p.slot,
            garment_type: p.spec.garment_type,
            color_family: p.spec.color_family,
            shade: p.spec.shade,
          })),
        }),
      },
      { type: "input_image", image_url: input.renderUrl, detail: "low" },
    ],
    format: {
      name: "look_verify",
      description: "Try-on render check.",
      schema: SCHEMA,
    },
    maxOutputTokens: 800,
    timeoutMs: 20_000,
  });

  const rec = value as {
    pass?: unknown;
    base_tee_visible?: unknown;
    face_changed?: unknown;
    extra_limb?: unknown;
    artifacts?: unknown;
    pieces?: unknown;
  };
  const artifacts = Array.isArray(rec.artifacts)
    ? rec.artifacts.filter((a): a is string => typeof a === "string")
    : [];
  const baseTeeVisible = rec.base_tee_visible === true;
  const faceChanged = rec.face_changed === true;
  const extraLimb = rec.extra_limb === true;
  const rawPieces = Array.isArray(rec.pieces) ? rec.pieces : [];
  const pieces: VerifyPiece[] = input.pieces.map((p) => {
    const hit = rawPieces.find((row) => {
      if (!row || typeof row !== "object") return false;
      return asSlot(String((row as { slot?: unknown }).slot ?? "")) === p.slot;
    }) as
      | { present?: unknown; observed_family?: unknown; matches?: unknown }
      | undefined;
    const observedRaw = String(hit?.observed_family ?? "").toLowerCase();
    const observedFamily = (observedRaw || null) as ColorFamily | null;
    const present = hit?.present === true && !baseTeeVisible;
    const matches =
      present &&
      hit?.matches !== false &&
      (!observedFamily || familiesCompatible(observedFamily, p.spec.color_family));
    return {
      slot: p.slot,
      family: p.spec.color_family,
      present: Boolean(present),
      observedFamily,
      matches: Boolean(matches),
    };
  });

  const top = pieces.find((p) => p.slot === "top" || p.slot === "one_piece");
  const pass =
    rec.pass === true &&
    !baseTeeVisible &&
    !faceChanged &&
    !extraLimb &&
    Boolean(top?.present && top.matches);

  return {
    pass,
    pieces,
    artifacts,
    baseTeeVisible,
    faceChanged,
    extraLimb,
  };
}
