/**
 * Prepare product photos for fashion curation multimodal input.
 *
 * Anthropic many-image requests reject any edge > 2000px. We always fetch and
 * sharp-resize to CURATION_IMAGE_MAX_PX so merchant originals (any host) are safe.
 */
import sharp from "sharp";
import { catalogDisplayImageUrl } from "@/lib/shopify/catalog-display-image";
import { logAiChat } from "@/lib/ai-chat/observability";
import { CURATION_IMAGE_MAX_PX } from "./config";

export type CurationImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg";
    data: string;
  };
};

const FETCH_MAX_BYTES = 2_500_000;
const JPEG_QUALITY = 82;

export async function fetchAndResizeCurationImage(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<CurationImageBlock | null> {
  const raw = imageUrl.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;

  // Prefer CDN-resized source when available (smaller download); sharp still
  // enforces the dimension cap for every host.
  const fetchUrl = catalogDisplayImageUrl(raw, CURATION_IMAGE_MAX_PX, {
    crop: "center",
  });

  try {
    const res = await fetch(fetchUrl, {
      signal,
      headers: { Accept: "image/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > FETCH_MAX_BYTES) return null;

    const resized = await sharp(buf)
      .rotate() // honor EXIF orientation
      .resize({
        width: CURATION_IMAGE_MAX_PX,
        height: CURATION_IMAGE_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: resized.toString("base64"),
      },
    };
  } catch (error) {
    if (signal?.aborted) return null;
    logAiChat("warn", "fashion_curation_image_prepare_failed", {
      url: raw.slice(0, 120),
      error: String(error).slice(0, 160),
    });
    return null;
  }
}

export async function prepareCurationImages(params: {
  urls: Array<{ ref: string; url: string }>;
  signal?: AbortSignal;
}): Promise<{
  byRef: Map<string, CurationImageBlock>;
  prepared: number;
  failed: number;
}> {
  const byRef = new Map<string, CurationImageBlock>();
  const results = await Promise.all(
    params.urls.map(async ({ ref, url }) => {
      const block = await fetchAndResizeCurationImage(url, params.signal);
      return { ref, block };
    }),
  );

  let prepared = 0;
  let failed = 0;
  for (const { ref, block } of results) {
    if (block) {
      byRef.set(ref, block);
      prepared += 1;
    } else {
      failed += 1;
    }
  }

  return { byRef, prepared, failed };
}
