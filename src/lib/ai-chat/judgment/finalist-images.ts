/**
 * Product photos for the tier-judge deep compare pass only.
 * Triage stays text-only; images are prefetched in parallel during triage.
 */
import {
  extractCatalogImageUrl,
  resolvePurchasableVariant,
} from "@/lib/shopify/catalog";
import { catalogDisplayImageUrl } from "@/lib/shopify/catalog-display-image";
import {
  JUDGE_IMAGE_MAX_BYTES,
  JUDGE_IMAGE_MAX_PX,
} from "../constants";
import { logAiChat } from "../observability";
import type { VerifiedCandidate } from "../search/verify";

export type JudgeImage = {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string;
};

export type FinalistImageEntry = {
  imageRef: string;
  productId: string;
};

export type FinalistImagePrefetch = {
  resolveFor: (entries: FinalistImageEntry[]) => Promise<Map<string, JudgeImage>>;
};

const ALLOWED_MEDIA = new Set<JudgeImage["mediaType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function normalizeMediaType(raw: string | null | undefined): JudgeImage["mediaType"] | null {
  const ct = raw?.split(";")[0]?.trim().toLowerCase();
  if (ct === "image/jpg") return "image/jpeg";
  if (ct && ALLOWED_MEDIA.has(ct as JudgeImage["mediaType"])) {
    return ct as JudgeImage["mediaType"];
  }
  return null;
}

/** Best-effort thumbnail URL — Shopify CDN honors `width`; others pass through. */
export function judgeThumbnailUrl(imageUrl: string): string {
  return catalogDisplayImageUrl(imageUrl, JUDGE_IMAGE_MAX_PX, { crop: "center" });
}

export function extractVerifiedImageUrl(vc: VerifiedCandidate): string | null {
  const detail = vc.judgeDetail ?? vc.detail;
  const variant = resolvePurchasableVariant(detail) ?? detail.variants?.[0];
  return (
    (variant && extractCatalogImageUrl(variant)) ||
    extractCatalogImageUrl(detail) ||
    null
  );
}

/** Fetch + base64 encode one product photo for multimodal judge input. */
export async function fetchJudgeImage(
  imageUrl: string | undefined,
  signal?: AbortSignal,
): Promise<JudgeImage | null> {
  const url = imageUrl?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;
    const mediaType = normalizeMediaType(res.headers.get("content-type"));
    if (!mediaType) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > JUDGE_IMAGE_MAX_BYTES) return null;
    return { mediaType, data: buf.toString("base64") };
  } catch (error) {
    logAiChat("warn", "judge_image_fetch_failed", {
      url: url.slice(0, 120),
      error: String(error).slice(0, 160),
    });
    return null;
  }
}

/**
 * Kick off parallel fetches for judge-candidate photos while triage runs.
 * Only finalists selected after triage consume the warmed cache.
 */
export function startFinalistImagePrefetch(
  candidates: VerifiedCandidate[],
  signal?: AbortSignal,
): FinalistImagePrefetch {
  const byProductId = new Map<string, Promise<JudgeImage | null>>();
  for (const vc of candidates) {
    const rawUrl = extractVerifiedImageUrl(vc);
    if (!rawUrl) continue;
    const thumbUrl = judgeThumbnailUrl(rawUrl);
    byProductId.set(
      vc.detail.id,
      fetchJudgeImage(thumbUrl, signal),
    );
  }

  return {
    async resolveFor(entries: FinalistImageEntry[]): Promise<Map<string, JudgeImage>> {
      const out = new Map<string, JudgeImage>();
      const ids = [...new Set(entries.map((e) => e.productId))];
      const results = await Promise.all(
        ids.map(async (productId) => {
          const pending = byProductId.get(productId);
          if (!pending) return { productId, image: null as JudgeImage | null };
          const image = await pending;
          return { productId, image };
        }),
      );
      let fetched = 0;
      for (const { productId, image } of results) {
        if (image) {
          out.set(productId, image);
          fetched += 1;
        }
      }
      logAiChat("info", "judge_images_resolved", {
        requested: ids.length,
        fetched,
        prefetched: byProductId.size,
      });
      return out;
    },
  };
}
