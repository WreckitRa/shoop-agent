import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PaletteSwatch } from "@/lib/photo-analysis/style-contract";
import { hexForSwatch } from "@/lib/photo-analysis/family-hex";
import {
  createSignedUrl,
  uploadPrivateObject,
} from "@/lib/tryon/storage";
import { runLooksFashn } from "./fashn";
import { familyFromImageUrl } from "./garment-image";
import { familiesCompatible } from "./image-color";

const TEE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="960" viewBox="0 0 768 960">
  <path fill="#7A7A7A" d="M384 90c48 0 78 28 92 48l170-70 72 92-148 82v638H198V242L50 160l72-92 170 70c14-20 44-48 92-48z"/>
</svg>`;

const recolourCache = new Map<string, Buffer>();

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export async function recolouredTeePng(hex: string): Promise<Buffer> {
  const key = hex.toUpperCase();
  const hit = recolourCache.get(key);
  if (hit) return hit;
  const { r, g, b } = parseHex(key);
  const base = await sharp(Buffer.from(TEE_SVG)).png().toBuffer();
  const meta = await sharp(base).metadata();
  const w = meta.width ?? 768;
  const h = meta.height ?? 960;
  const out = await sharp(base)
    .ensureAlpha()
    .composite([
      {
        input: {
          create: {
            width: w,
            height: h,
            channels: 4,
            background: { r, g, b, alpha: 1 },
          },
        },
        blend: "multiply",
      },
    ])
    .png()
    .toBuffer();
  recolourCache.set(key, out);
  return out;
}

export type SwatchJobInput = {
  userId: string;
  photoHash: string;
  swatch: PaletteSwatch;
  kind: "yes" | "no";
  modelImageUrl: string;
};

export type SwatchJobResult = {
  status: "ready" | "chip";
  renderUrl: string | null;
  renderPath: string | null;
  credits: number;
  templateUrl: string | null;
};

export async function renderColorSwatch(input: SwatchJobInput): Promise<SwatchJobResult> {
  const hex = hexForSwatch(input.swatch);
  const png = await recolouredTeePng(hex);
  const filename = `swatch-${input.kind}-${input.swatch.family}-${hex.slice(1)}.png`;
  const { path } = await uploadPrivateObject({
    userId: input.userId,
    personId: input.photoHash,
    kind: "tryon",
    filename,
    bytes: png,
    contentType: "image/png",
  });
  const templateUrl = await createSignedUrl(path, 60 * 60);
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  let credits = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await runLooksFashn({
        modelName: "tryon-v1.6",
        inputs: {
          model_image: input.modelImageUrl,
          garment_image: dataUrl,
          category: "tops",
          mode: "balanced",
          garment_photo_type: "flat-lay",
          output_format: "jpeg",
          seed: parseInt(
            createHash("sha256")
              .update(`${input.userId}:${hex}:${attempt}`)
              .digest("hex")
              .slice(0, 8),
            16,
          ) % 1_000_000,
        },
      });
      credits += out.credits;
      const family = await familyFromImageUrl(out.url);
      if (family && !familiesCompatible(family, input.swatch.family)) {
        continue;
      }
      const stored = await uploadPrivateObject({
        userId: input.userId,
        personId: input.photoHash,
        kind: "tryon",
        filename: `swatch-on-${input.kind}-${hex.slice(1)}.jpg`,
        bytes: Buffer.from(await (await fetch(out.url)).arrayBuffer()),
        contentType: "image/jpeg",
      });
      const renderUrl = await createSignedUrl(stored.path, 60 * 60 * 24);
      return {
        status: "ready",
        renderUrl,
        renderPath: stored.path,
        credits,
        templateUrl,
      };
    } catch {
      // retry once, then chip
    }
  }
  return {
    status: "chip",
    renderUrl: null,
    renderPath: null,
    credits,
    templateUrl,
  };
}
