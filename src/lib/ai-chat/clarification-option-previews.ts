/**
 * Server-only: fetch visual preview collages for clarification option chips.
 * Best-effort — never throws; failures degrade to plain chips.
 */
import { createHash } from "node:crypto";
import { kvGet, kvSetex } from "@/lib/cache/kv-store";
import { logOptionPreview } from "@/lib/ai-chat/option-preview-log";
import type { ClarificationOptionPreviewImage } from "@/lib/ai-chat/types";
import { productUpid } from "@/lib/ai-chat/search/pool";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  extractCatalogImageUrl,
  searchCatalog,
  buildCatalogCallContext,
  type CatalogProductSummary,
  type CatalogSearchContext,
} from "@/lib/shopify/catalog";

const PREVIEW_DEADLINE_MS = 2500;
const PREVIEW_CACHE_TTL_SEC = 5 * 24 * 60 * 60;
const WARM_CANDIDATES_TTL_SEC = 10 * 60;
const MAX_CONCURRENCY = 6;
const PREVIEW_IMAGE_LIMIT = 4;
const CATALOG_PAGE_LIMIT = 20;

export type OptionPreviewRequest = {
  id: string;
  previewQuery: string;
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
    .update(`${normalizePreviewQuery(query)}|${country.toUpperCase()}`)
    .digest("hex")
    .slice(0, 32);
  return `clarification-preview:${hash}`;
}

export function warmCandidatesCacheKey(
  conversationId: string,
  optionId: string,
): string {
  return `clarification-warm:${conversationId}:${optionId}`;
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
): ClarificationOptionPreviewImage[] {
  const images: ClarificationOptionPreviewImage[] = [];
  const seenUrls = new Set<string>();
  const seenProducts = new Set<string>();
  let skippedNoImage = 0;

  for (const product of products) {
    const productId = productUpid(product);
    if (seenProducts.has(productId)) continue;

    const rawUrl = extractCatalogImageUrl(product);
    const url = normalizeImageUrl(rawUrl);
    if (!url) {
      skippedNoImage++;
      continue;
    }

    if (seenUrls.has(url)) continue;

    seenUrls.add(url);
    seenProducts.add(productId);
    images.push({
      url,
      title: product.title?.trim() || "Product",
      productId,
    });
    if (images.length >= PREVIEW_IMAGE_LIMIT) break;
  }

  if (skippedNoImage > 0 && !images.length) {
    logOptionPreview("extract_no_usable_images", {
      productCount: products.length,
      skippedNoImage,
    });
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

async function fetchOneOptionPreview(params: {
  option: OptionPreviewRequest;
  accessToken: string;
  shipsToCountry: string;
  context?: CatalogSearchContext;
  conversationId: string;
  deadlineAt: number;
}): Promise<OptionPreviewResult> {
  const { option, accessToken, shipsToCountry, context, conversationId } =
    params;

  if (Date.now() >= params.deadlineAt) {
    logOptionPreview("option_deadline_before_start", {
      optionId: option.id,
      query: option.previewQuery.slice(0, 80),
    });
    return { optionId: option.id, images: [] };
  }

  const cacheKey = previewCacheKey(option.previewQuery, shipsToCountry);
  try {
    const cached = await kvGet(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ClarificationOptionPreviewImage[];
      if (Array.isArray(parsed) && parsed.length) {
        logOptionPreview("cache_hit", {
          optionId: option.id,
          imageCount: parsed.length,
        });
        return { optionId: option.id, images: parsed };
      }
    }
  } catch {
    /* cache miss / corrupt */
  }

  if (Date.now() >= params.deadlineAt) {
    return { optionId: option.id, images: [] };
  }

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

    const products = res.products ?? [];
    const images = extractPreviewImages(products);

    logOptionPreview("catalog_result", {
      optionId: option.id,
      query: option.previewQuery.slice(0, 80),
      productCount: products.length,
      imageCount: images.length,
    });

    if (images.length) {
      void kvSetex(cacheKey, PREVIEW_CACHE_TTL_SEC, JSON.stringify(images));
    }

    if (products.length) {
      void kvSetex(
        warmCandidatesCacheKey(conversationId, option.id),
        WARM_CANDIDATES_TTL_SEC,
        JSON.stringify(products),
      );
    }

    return { optionId: option.id, images };
  } catch (err) {
    logOptionPreview("catalog_error", {
      optionId: option.id,
      query: option.previewQuery.slice(0, 80),
      error: String(err).slice(0, 200),
    });
    return { optionId: option.id, images: [] };
  }
}

/**
 * Resolve preview images for clarification options under a soft deadline.
 * Returns only options that got at least one image.
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
  } catch (err) {
    logOptionPreview("auth_error", {
      error: String(err).slice(0, 200),
    });
    return [];
  }

  logOptionPreview("batch_start", {
    conversationId: params.conversationId,
    country: shipsToCountry,
    optionCount: params.options.length,
    deadlineMs: PREVIEW_DEADLINE_MS,
  });

  const results = await mapWithConcurrency(
    params.options,
    MAX_CONCURRENCY,
    (option) =>
      fetchOneOptionPreview({
        option,
        accessToken,
        shipsToCountry,
        context: params.context,
        conversationId: params.conversationId,
        deadlineAt,
      }),
  );

  const withImages = results.filter((r) => r.images.length > 0);
  logOptionPreview("batch_done", {
    conversationId: params.conversationId,
    requested: params.options.length,
    withImages: withImages.length,
  });

  return withImages;
}

/** Load warm catalog candidates stashed during preview fetch. */
export async function loadWarmCandidatesForOptions(params: {
  conversationId: string;
  optionIds: string[];
}): Promise<CatalogProductSummary[]> {
  if (!params.optionIds.length) return [];

  const merged: CatalogProductSummary[] = [];
  const seen = new Set<string>();

  for (const optionId of params.optionIds) {
    try {
      const raw = await kvGet(
        warmCandidatesCacheKey(params.conversationId, optionId),
      );
      if (!raw) continue;
      const products = JSON.parse(raw) as CatalogProductSummary[];
      if (!Array.isArray(products)) continue;
      for (const product of products) {
        const key = productUpid(product);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(product);
      }
    } catch {
      /* expired or corrupt */
    }
  }

  return merged;
}
