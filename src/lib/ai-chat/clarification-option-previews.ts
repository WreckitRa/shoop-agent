/**
 * Server-only: fetch visual preview collages for clarification option chips.
 * Best-effort — never throws; failures degrade to plain chips.
 *
 * Style/mood images are vision-gated (cheap Haiku) so each option gets a
 * distinct, on-brief product photo when the deadline allows.
 */
import { createHash } from "node:crypto";
import { kvGet, kvSetex } from "@/lib/cache/kv-store";
import type { ClarificationOptionPreviewImage } from "@/lib/ai-chat/types";
import { productUpid } from "@/lib/ai-chat/product-upid";
import { scoreClarificationPreviewImage } from "@/lib/ai-chat/clarification-preview-vision";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  extractCatalogImageUrl,
  searchCatalog,
  buildCatalogCallContext,
  type CatalogProductSummary,
  type CatalogSearchContext,
} from "@/lib/shopify/catalog";

/** Soft wall-clock for catalog + vision; stream races this with ~5.5s. */
const PREVIEW_DEADLINE_MS = 5000;
const PREVIEW_CACHE_TTL_SEC = 5 * 24 * 60 * 60;
const MAX_CONCURRENCY = 6;
const PREVIEW_IMAGE_LIMIT = 4;
const CATALOG_PAGE_LIMIT = 24;
/** How many candidates to vision-check per option before giving up. */
const VISION_CANDIDATE_LIMIT = 5;

export type OptionPreviewRequest = {
  id: string;
  previewQuery: string;
  /** Human label used by the vision gate (style/mood). */
  label?: string;
};

export type OptionPreviewResult = {
  optionId: string;
  images: ClarificationOptionPreviewImage[];
};

function normalizePreviewQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function previewCacheKey(query: string, country: string): string {
  const hash = createHash("sha256")
    .update(`v2|${normalizePreviewQuery(query)}|${country.toUpperCase()}`)
    .digest("hex")
    .slice(0, 32);
  return `clarification-preview:${hash}`;
}

function normalizeImageUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const url = raw.trim();
  if (url.startsWith("https:")) return url;
  if (url.startsWith("http:")) return url.replace(/^http:/, "https:");
  if (url.startsWith("//")) return `https:${url}`;
  return null;
}

function extractPreviewImages(
  products: CatalogProductSummary[],
  limit = PREVIEW_IMAGE_LIMIT,
): ClarificationOptionPreviewImage[] {
  const images: ClarificationOptionPreviewImage[] = [];
  const seenUrls = new Set<string>();
  const seenProducts = new Set<string>();

  for (const product of products) {
    const productId = productUpid(product);
    if (seenProducts.has(productId)) continue;

    const rawUrl = extractCatalogImageUrl(product);
    const url = normalizeImageUrl(rawUrl);
    if (!url) continue;
    if (seenUrls.has(url)) continue;

    seenUrls.add(url);
    seenProducts.add(productId);
    images.push({
      url,
      title: product.title?.trim() || "Product",
      productId,
    });
    if (images.length >= limit) break;
  }

  return images;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function searchOptionCandidates(params: {
  option: OptionPreviewRequest;
  accessToken: string;
  shipsToCountry: string;
  context?: CatalogSearchContext;
  deadlineAt: number;
}): Promise<ClarificationOptionPreviewImage[]> {
  const { option, accessToken, shipsToCountry, context } = params;

  if (Date.now() >= params.deadlineAt) return [];

  const cacheKey = previewCacheKey(option.previewQuery, shipsToCountry);
  try {
    const cached = await kvGet(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ClarificationOptionPreviewImage[];
      if (Array.isArray(parsed) && parsed.length) {
        return parsed;
      }
    }
  } catch {
    /* cache miss / corrupt */
  }

  if (Date.now() >= params.deadlineAt) return [];

  try {
    const filters = {
      available: true,
      ships_to: { country: shipsToCountry.toUpperCase() },
    };
    const res = await searchCatalog(
      accessToken,
      option.previewQuery,
      filters,
      {
        context: buildCatalogCallContext(filters, context),
        limit: CATALOG_PAGE_LIMIT,
      },
    );

    const images = extractPreviewImages(res.products ?? [], CATALOG_PAGE_LIMIT);
    if (images.length) {
      void kvSetex(cacheKey, PREVIEW_CACHE_TTL_SEC, JSON.stringify(images));
    }
    return images;
  } catch {
    return [];
  }
}

async function pickVisionGatedImages(params: {
  label: string;
  candidates: ClarificationOptionPreviewImage[];
  usedUrls: Set<string>;
  usedProducts: Set<string>;
  deadlineAt: number;
}): Promise<ClarificationOptionPreviewImage[]> {
  const available = params.candidates.filter(
    (img) =>
      !params.usedUrls.has(img.url) && !params.usedProducts.has(img.productId),
  );
  if (!available.length) return [];

  const accepted: ClarificationOptionPreviewImage[] = [];
  let checked = 0;

  for (const candidate of available) {
    if (accepted.length >= PREVIEW_IMAGE_LIMIT) break;
    if (Date.now() >= params.deadlineAt) {
      // Deadline: fill remaining slots with unused catalog hits (no more vision).
      for (const fallback of available) {
        if (accepted.length >= PREVIEW_IMAGE_LIMIT) break;
        if (
          params.usedUrls.has(fallback.url) ||
          params.usedProducts.has(fallback.productId) ||
          accepted.some((a) => a.url === fallback.url)
        ) {
          continue;
        }
        accepted.push(fallback);
        params.usedUrls.add(fallback.url);
        params.usedProducts.add(fallback.productId);
      }
      break;
    }

    if (checked >= VISION_CANDIDATE_LIMIT && accepted.length > 0) break;

    checked += 1;
    const verdict = await scoreClarificationPreviewImage({
      label: params.label,
      imageUrl: candidate.url,
      deadlineAt: params.deadlineAt,
    });

    if (!verdict.ok && verdict.reason !== "vision_error_fail_open") {
      continue;
    }

    accepted.push(candidate);
    params.usedUrls.add(candidate.url);
    params.usedProducts.add(candidate.productId);
  }

  // If vision rejected everything, still show the first unused catalog image.
  if (!accepted.length) {
    const fallback = available[0]!;
    accepted.push(fallback);
    params.usedUrls.add(fallback.url);
    params.usedProducts.add(fallback.productId);
  }

  return accepted.slice(0, PREVIEW_IMAGE_LIMIT);
}

/**
 * Resolve preview images for clarification options under a soft deadline.
 * Returns only options that got at least one image.
 * Cross-option URL/product dedup + vision gate keep moods visually distinct.
 */
export async function fetchClarificationOptionPreviews(params: {
  options: OptionPreviewRequest[];
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  conversationId: string;
}): Promise<OptionPreviewResult[]> {
  if (!params.options.length || !params.shipsToCountry?.trim()) return [];
  const shipsToCountry = params.shipsToCountry.trim();

  const deadlineAt = Date.now() + PREVIEW_DEADLINE_MS;
  let accessToken = "";
  try {
    accessToken = await accessTokenForCatalogMcp();
  } catch {
    return [];
  }

  const candidateLists = await mapWithConcurrency(
    params.options,
    MAX_CONCURRENCY,
    (option) =>
      searchOptionCandidates({
        option,
        accessToken,
        shipsToCountry,
        context: params.context,
        deadlineAt,
      }),
  );

  const usedUrls = new Set<string>();
  const usedProducts = new Set<string>();
  const results: OptionPreviewResult[] = [];

  // Sequential vision pick so options don't steal the same hero image.
  for (let i = 0; i < params.options.length; i++) {
    const option = params.options[i]!;
    const candidates = candidateLists[i] ?? [];
    if (!candidates.length) continue;

    const label = option.label?.trim() || option.previewQuery;
    const images = await pickVisionGatedImages({
      label,
      candidates,
      usedUrls,
      usedProducts,
      deadlineAt,
    });

    if (images.length) {
      results.push({ optionId: option.id, images });
    }
  }

  return results;
}
