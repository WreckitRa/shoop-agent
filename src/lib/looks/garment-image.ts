import sharp from "sharp";
import {
  collectCatalogImageUrls,
  type CatalogProductDetail,
  type GetProductResult,
} from "@/lib/shopify/catalog";
import type { ColorFamily, ContractPiece } from "@/lib/photo-analysis/style-contract";
import { mapLimit } from "./limit";
import { dominantRgbFromRgba, familiesCompatible, familyFromRgb } from "./image-color";
import type { PieceCandidate } from "./retrieve";

export type GarmentImageOk = PieceCandidate & {
  garmentImageUrls: string[];
  observedFamily: ColorFamily;
  garmentPhotoType: "flat-lay" | "model";
  colorAvailable: boolean;
};

export type GarmentImageDrop = PieceCandidate & {
  dropReason: "variant_unavailable" | "variant_image_color_mismatch" | "no_variant_media";
};

export type GarmentImageResult = GarmentImageOk | GarmentImageDrop;

export function isGarmentImageOk(row: GarmentImageResult): row is GarmentImageOk {
  return !("dropReason" in row);
}

async function fetchRgba(url: string): Promise<{ data: Buffer; info: sharp.OutputInfo } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buf)
      .resize(128, 128, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, info };
  } catch {
    return null;
  }
}

export async function familyFromImageUrl(url: string): Promise<ColorFamily | null> {
  const raw = await fetchRgba(url);
  if (!raw) return null;
  const rgb = dominantRgbFromRgba(raw.data, raw.info.width, raw.info.height);
  return rgb ? familyFromRgb(rgb) : null;
}

function colorValueAvailable(
  detail: CatalogProductDetail | undefined,
  label: string | null,
): boolean {
  if (!label) return true;
  const color = detail?.options?.find((o) => /^colou?r$/i.test(o.name));
  const value = color?.values.find((v) => v.label === label);
  if (!value) return true;
  if (value.available === false) return false;
  return true;
}

function guessPhotoType(urls: string[]): "flat-lay" | "model" {
  const blob = urls.join(" ").toLowerCase();
  if (/\b(flat|ghost|packshot|still.?life|layflat)\b/.test(blob)) return "flat-lay";
  return "model";
}

export type GetProductFn = (
  productId: string,
  selected: Array<{ name: string; label: string }>,
) => Promise<GetProductResult>;

export async function resolveGarmentImages(
  candidates: PieceCandidate[],
  piece: ContractPiece,
  get: GetProductFn,
): Promise<GarmentImageResult[]> {
  return mapLimit(candidates, 8, async (candidate) => {
    const selected = candidate.matchedColorLabel
      ? [{ name: "Color", label: candidate.matchedColorLabel }]
      : [];
    let detail: CatalogProductDetail | undefined;
    try {
      const result = await get(candidate.product.id, selected);
      detail = result.product;
    } catch {
      return { ...candidate, dropReason: "no_variant_media" as const };
    }
    if (!detail) {
      return { ...candidate, dropReason: "no_variant_media" as const };
    }
    if (!colorValueAvailable(detail, candidate.matchedColorLabel)) {
      return { ...candidate, dropReason: "variant_unavailable" as const };
    }
    const variant = detail.variants?.find((v) =>
      candidate.matchedColorLabel
        ? v.options?.some(
            (o) => /^colou?r$/i.test(o.name) && o.label === candidate.matchedColorLabel,
          )
        : true,
    );
    const urls = collectCatalogImageUrls(detail, variant).slice(0, 3);
    if (!urls.length) {
      return { ...candidate, dropReason: "no_variant_media" as const };
    }
    const families = (
      await Promise.all(urls.map((url) => familyFromImageUrl(url)))
    ).filter((f): f is ColorFamily => Boolean(f));
    if (!families.length) {
      return {
        ...candidate,
        garmentImageUrls: urls,
        observedFamily: piece.color_family,
        garmentPhotoType: guessPhotoType(urls),
        colorAvailable: true,
      };
    }
    const match = families.find((f) => familiesCompatible(f, piece.color_family));
    if (!match) {
      return { ...candidate, dropReason: "variant_image_color_mismatch" as const };
    }
    return {
      ...candidate,
      garmentImageUrls: urls,
      observedFamily: match,
      garmentPhotoType: guessPhotoType(urls),
      colorAvailable: true,
    };
  });
}

/** Test hook: drop when every sampled family misses the piece. */
export function dropIfImageFamiliesMiss(
  families: ColorFamily[],
  expected: ColorFamily,
): boolean {
  if (!families.length) return false;
  return families.every((f) => !familiesCompatible(f, expected));
}
