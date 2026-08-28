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
  pickLookProduct,
  productTitleKey,
  readingLookQueries,
  type ReadingLookItem,
  type ReadingLookProduct,
} from "./reading-looks";
import type { StylistVerdict } from "./verdict";

const SEARCH_LIMIT = 8;
const SEARCH_TIMEOUT_MS = 8_000;

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

  const rows = await Promise.all(
    queries.map(async (q) => {
      const query =
        opts.department && opts.department !== "mixed"
          ? ensureDepartmentQueryPrefix(q.query, opts.department)
          : q.query;
      try {
        const res = await search(token, query, filters, {
          limit: SEARCH_LIMIT,
          context,
          signal: abortSignalWithTimeout(scope.fork(), SEARCH_TIMEOUT_MS),
        });
        return { q, hits: res.products ?? [] };
      } catch {
        return { q, hits: [] as CatalogProductSummary[] };
      }
    }),
  );

  const usedIds = new Set<string>();
  const usedTitlesByLook = new Map<string, Set<string>>();
  return rows.map(({ q, hits }) => {
    const lookKey = q.lookId ?? q.key;
    let usedTitles = usedTitlesByLook.get(lookKey);
    if (!usedTitles) {
      usedTitles = new Set();
      usedTitlesByLook.set(lookKey, usedTitles);
    }
    const product = pickLookProduct(
      candidatesFromHits(hits),
      usedIds,
      usedTitles,
    );
    if (product) {
      usedIds.add(product.id);
      const titleKey = productTitleKey(product.title);
      if (titleKey) usedTitles.add(titleKey);
    }
    return { ...q, product } satisfies ReadingLookItem;
  });
}
