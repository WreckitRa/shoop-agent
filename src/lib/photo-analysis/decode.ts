import sharp from "sharp";
import { createHash } from "node:crypto";
import type { ImagePixels } from "./types";

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export function hashPhoto(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function decodeImage(bytes: Buffer): Promise<ImagePixels> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
}

export async function jpegForGpt(
  bytes: Buffer,
): Promise<{ mime: "image/jpeg"; base64: string }> {
  const buf = await sharp(bytes)
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  return { mime: "image/jpeg", base64: buf.toString("base64") };
}
