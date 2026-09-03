import { abortSignalWithTimeout, createAbortScope } from "@/lib/ai-chat/abort-scope";
import {
  TARGET_GENDER_FILTER_VALUES,
  ensureDepartmentQueryPrefix,
  type PersonDepartment,
} from "@/lib/fashion-memory/department";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { resolveSearchCatalog } from "@/lib/shopify/catalog-client-override";
import {
  extractCatalogImageUrl,
  searchFeaturedVariantFromProduct,
  type CatalogProductSummary,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import {
  fallbackLookQuery,
  fallbackFaceQuery,
  pickLookProduct,
  productTitleKey,
  readingLookQueries,
  type ReadingLookItem,
  type ReadingLookProduct,
} from "./reading-looks";
import type { StylistVerdict } from "./verdict";
import { logVerdict } from "./verdict-log";

const SEARCH_LIMIT = 8;
const SEARCH_TIMEOUT_MS = 8_000;
const SEARCH_CONCURRENCY = 2;
const RATE_LIMIT_RETRIES = 4;

function isRateLimited(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit/i.test(msg);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    if (signal?.aborted) {
      clearTimeout(t);
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function productFromHit(
  hit: CatalogProductSummary,
): ReadingLookProduct | null {
  const imageUrl = extractCatalogImageUrl(hit);
  const title = hit.title?.trim();
  if (!hit.id || !imageUrl || !title) return null;
  const featured = searchFeaturedVariantFromProduct(hit);
  const price =
    featured?.price ??
    hit.price_range?.min ??
    null;
  return {
    id: hit.id,
    title,
    imageUrl,
    price: price?.amount != null && price.currency ? price : null,
  };
}

function candidatesFromHits(
  hits: CatalogProductSummary[] | undefined,
): ReadingLookProduct[] {
  const out: ReadingLookProduct[] = [];
  for (const hit of hits ?? []) {
    const product = productFromHit(hit);
    if (product) out.push(product);
  }
  return out;
}

export async function runReadingLooks(opts: {
  verdict: StylistVerdict;
  department: PersonDepartment | null;
  currency?: string | null;
  country?: string | null;
  signal?: AbortSignal;
}): Promise<ReadingLookItem[]> {
  const queries = readingLookQueries(opts.verdict);
  logVerdict("looks-search start", {
    queries: queries.length,
    looks: queries.filter((q) => q.kind === "look").length,
    buys: queries.filter((q) => q.kind === "buy").length,
    swatches: queries.filter((q) => q.kind === "swatch").length,
    avoids: queries.filter((q) => q.kind === "avoid").length,
  });
  if (!queries.length) return [];

  const token = await accessTokenForCatalogMcp();
  const gender = opts.department
    ? TARGET_GENDER_FILTER_VALUES[opts.department]
    : null;
  const country = opts.country?.trim().toUpperCase();
  const filters: CatalogSearchFilters = {
    available: true,
    ...(country && /^[A-Z]{2}$/.test(country)
      ? { ships_to: { country } }
      : {}),
    ...(gender?.length
      ? { attributes: [{ name: "Target gender", values: [...gender] }] }
      : {}),
  };
  const currency = opts.currency?.trim().toUpperCase().slice(0, 6);
  const context = {
    ...(currency ? { currency } : {}),
    ...(country && /^[A-Z]{2}$/.test(country)
      ? { address_country: country }
      : {}),
    intent: "Onboarding reading — illustrate the stylist verdict",
  };
  const scope = createAbortScope(opts.signal);
  const search = resolveSearchCatalog();

  const rows = await mapLimit(queries, SEARCH_CONCURRENCY, async (q) => {
    const prefixed = (raw: string) =>
      opts.department && opts.department !== "mixed"
        ? ensureDepartmentQueryPrefix(raw, opts.department)
        : raw;

    const runSearch = async (query: string) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await search(token, prefixed(query), filters, {
            limit: SEARCH_LIMIT,
            context,
            signal: abortSignalWithTimeout(scope.fork(), SEARCH_TIMEOUT_MS),
          });
        } catch (err) {
          if (
            !isRateLimited(err) ||
            attempt >= RATE_LIMIT_RETRIES ||
            opts.signal?.aborted
          ) {
            throw err;
          }
          const wait = 700 * 2 ** attempt;
          logVerdict("looks-search wait", {
            kind: q.kind,
            id: q.lookId ?? q.key,
            q: query,
            attempt: attempt + 1,
            ms: wait,
          });
          await sleep(wait, opts.signal);
        }
      }
    };

    try {
      const first = await runSearch(q.query);
      let hits = first.products ?? [];
      let retried = false;
      const retry =
        q.kind === "swatch" || q.kind === "avoid"
          ? fallbackFaceQuery(q.query, q.piece)
          : fallbackLookQuery(q.query, q.piece);
      if (!hits.length && retry) {
        retried = true;
        const second = await runSearch(retry);
        hits = second.products ?? [];
      }
      return { q, hits, retried };
    } catch (err) {
      logVerdict("looks-search error", {
        kind: q.kind,
        id: q.lookId ?? q.key,
        q: q.query,
        error: err instanceof Error ? err.message : "unknown",
      });
      return {
        q,
        hits: [] as CatalogProductSummary[],
        retried: false,
      };
    }
  });

  const usedIds = new Set<string>();
  const usedTitlesByLook = new Map<string, Set<string>>();
  const usedSwatchIds = new Set<string>();
  const usedAvoidIds = new Set<string>();
  const items = rows.map(({ q, hits, retried }) => {
    const lookKey = q.lookId ?? q.key;
    let usedTitles = usedTitlesByLook.get(lookKey);
    if (!usedTitles) {
      usedTitles = new Set();
      usedTitlesByLook.set(lookKey, usedTitles);
    }
    const usedFace =
      q.kind === "avoid"
        ? usedAvoidIds
        : q.kind === "swatch"
          ? usedSwatchIds
          : usedIds;
    const candidates = candidatesFromHits(hits);
    const product = pickLookProduct(candidates, usedFace, usedTitles);
    if (product) {
      usedFace.add(product.id);
      const titleKey = productTitleKey(product.title);
      if (titleKey) usedTitles.add(titleKey);
    }
    logVerdict("looks-search", {
      kind: q.kind,
      id: q.lookId ?? q.key,
      q: q.query,
      hits: hits.length,
      usable: candidates.length,
      retry: retried || undefined,
      picked: product?.title ?? null,
      miss: product
        ? undefined
        : hits.length
          ? "duplicate"
          : "no_hits",
    });
    return {
      ...q,
      product: product
        ? { ...product, garment: q.piece || q.query }
        : null,
    } satisfies ReadingLookItem;
  });
    logVerdict("looks-search done", {
      hit: items.filter((item) => item.product).length,
      miss: items.filter((item) => !item.product).length,
    });
    return items;
  }
