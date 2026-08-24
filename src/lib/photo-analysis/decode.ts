import sharp from "sharp";
import { createHash } from "node:crypto";

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export function hashPhoto(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function jpegDataUrl(
  bytes: Buffer,
  maxEdge: number,
  quality: number,
): Promise<string> {
  const buf = await sharp(bytes)
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** Low-res JPEG for the Luna gate (`detail: low`). */
export function jpegDataUrlLow(bytes: Buffer): Promise<string> {
  return jpegDataUrl(bytes, 512, 55);
}

/** High-res JPEG for the Terra analysis (`detail: original`). */
export function jpegDataUrlOriginal(bytes: Buffer): Promise<string> {
  return jpegDataUrl(bytes, 2048, 90);
}
