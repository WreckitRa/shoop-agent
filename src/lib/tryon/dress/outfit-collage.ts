import sharp from "sharp";
import { fetchImageBytes } from "../providers/image-utils";

const CELL_W = 512;
const CELL_H = 640;

/**
 * FASHN API takes one product/garment image per request. Their docs say to put
 * multiple products in the same image (or chain calls). This builds a white
 * collage of garment reference photos so one tryon-max / tryon-v1.6 call can
 * dress the full look.
 */
export async function buildOutfitGarmentCollage(params: {
  imageUrls: string[];
}): Promise<{ dataUrl: string; width: number; height: number; count: number }> {
  const urls = params.imageUrls.filter(Boolean);
  if (!urls.length) {
    throw new Error("No garment images for outfit collage");
  }

  const prepared: Buffer[] = [];
  for (const url of urls) {
    const bytes = await fetchImageBytes(url);
    const buf = await sharp(Buffer.from(bytes))
      .rotate()
      .resize(CELL_W, CELL_H, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    prepared.push(buf);
  }

  const n = prepared.length;
  const cols = n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const width = cols * CELL_W;
  const height = rows * CELL_H;

  const composites = prepared.map((input, i) => ({
    input,
    left: (i % cols) * CELL_W,
    top: Math.floor(i / cols) * CELL_H,
  }));

  const out = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
    width,
    height,
    count: n,
  };
}

/** Prompt for tryon-max when product_image is a multi-garment collage. */
export function buildOutfitCollagePrompt(params: {
  titles: string[];
  types: string[];
}): string {
  const pieces = params.titles
    .map((title, i) => {
      const type = params.types[i];
      return type ? `${title} (${type})` : title;
    })
    .filter(Boolean);
  const list = pieces.length ? pieces.join("; ") : "all garments in the product image";
  return [
    `Dress the person in the COMPLETE outfit shown in the product image collage.`,
    `Apply EVERY garment visible in the collage together as one coordinated look: ${list}.`,
    `Do not leave the person in their original clothes — replace with this full outfit.`,
    `Preserve garment colors, fabrics, patterns, and silhouettes from each collage tile.`,
    `Full-body result — head to toe must show all applied pieces naturally layered.`,
  ].join(" ");
}
