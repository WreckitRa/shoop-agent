/**
 * Stage 2 — Retrieval & Candidate Pool (docs/search-improvements.md §6 step 4).
 *
 * Fires the portfolio queries in parallel, unions the hits, de-dupes by UPID
 * (cross-merchant cluster id), and tracks which queries surfaced each candidate
 * + at what rank (for the corroboration signal). Includes the thin-pool
 * widening ladder: broaden -> drop price.max (loosened) -> page 2.
 */
import {
  productSearchSummaryInStock,
  searchCatalog,
  buildCatalogCallContext,
  type CatalogProductSummary,
  type CatalogSearchContext,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import type { CatalogMcpExchange } from "@/lib/shopify/catalog-mcp-audit";
import { convertPriceCents, type FxRateTable } from "@/lib/shopify/fx-rates";
import { logFindSimilar } from "./find-similar/debug-log";
import { logAiChat } from "../observability";
import type { EngineMcpAuditEvent, EngineMcpCallKind } from "./engine-audit";
import { sanitizePortfolioQuery } from "./query-hygiene";
import { discoverDominantCategory } from "./shopifyTaxonomyMap";
import { buildTaxonomyAttributeFilters } from "./taxonomy-attribute-filters";
import type { PoolCandidate, PortfolioQuery, QuerySource, SearchBrief } from "./types";

/** Default catalog page size for each portfolio query (max allowed is 50). */
const DEFAULT_LIMIT = 50;

/** Pool is "thin" below this many de-duped candidates — triggers widening. */
const DEFAULT_THIN_THRESHOLD = 8;

export type QueryYieldStat = {
  queryId: string;
  text: string;
  rawCount: number;
  poolContribution: number;
  isDiscovery: boolean;
  loosened: boolean;
};

export type PoolResult = {
  candidates: PoolCandidate[];
  stats: QueryYieldStat[];
  /** True when, even after widening, the pool stayed below the threshold. */
  thin: boolean;
  /** True when at least one loosened (budget-relaxed) query was fired. */
  loosened: boolean;
};

/** Best-effort cross-merchant cluster id; falls back to product id. */
export function productUpid(product: CatalogProductSummary): string {
  const raw = product as unknown as Record<string, unknown>;
  for (const key of ["upid", "universal_product_id", "universalProductId", "product_id"]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return product.id;
}

/** Resolved variant/price-range price in cents, or null. */
export function candidatePriceCents(
  product: CatalogProductSummary,
): number | null {
  const v = product.variants?.[0]?.price?.amount;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const min = product.price_range?.min?.amount;
  if (typeof min === "number" && Number.isFinite(min)) return min;
  return null;
}

/** Presentment ISO currency on the catalog hit, if any. */
export function candidatePriceCurrency(
  product: CatalogProductSummary,
): string | null {
  const v = product.variants?.[0]?.price?.currency;
  if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
  const min = product.price_range?.min?.currency;
  if (typeof min === "string" && min.trim()) return min.trim().toUpperCase();
  return null;
}

/**
 * Price in the buyer's currency for scoring/budget — converts via FX when needed.
 * Falls back to raw cents when currencies match or FX is unavailable.
 */
export function candidatePriceCentsForBuyer(
  product: CatalogProductSummary,
  buyerCurrency?: string | null,
  fx?: FxRateTable | null,
): number | null {
  const raw = candidatePriceCents(product);
  if (raw == null) return null;
  const from = candidatePriceCurrency(product);
  const to = buyerCurrency?.trim().toUpperCase();
  if (!from || !to || from === to || !fx) return raw;
  return convertPriceCents(raw, from, to, fx) ?? raw;
}

function filtersForQuery(
  q: PortfolioQuery,
  shipsToCountry?: string,
  opts?: { dropCategory?: boolean; dropPriceMax?: boolean; brief?: SearchBrief; taxonomyPrefilter?: boolean },
): CatalogSearchFilters {
  const f: CatalogSearchFilters = { available: true };
  if (q.condition?.length) f.condition = q.condition;
  const price: { min?: number; max?: number } = {};
  if (q.priceMinCents != null) price.min = q.priceMinCents;
  if (q.priceMaxCents != null && !opts?.dropPriceMax) price.max = q.priceMaxCents;
  if (price.min != null || price.max != null) f.price = price;
  if (shipsToCountry) f.ships_to = { country: shipsToCountry.toUpperCase() };
  if (q.categoryGid && !opts?.dropCategory) {
    f.categories = [q.categoryGid];
  }
  if (opts?.taxonomyPrefilter && opts.brief) {
    const attributes = buildTaxonomyAttributeFilters(opts.brief);
    if (attributes?.length) f.attributes = attributes;
  }
  return f;
}

type SingleQueryResult = {
  query: PortfolioQuery;
  products: CatalogProductSummary[];
  loosened: boolean;
};

async function runOneQuery(
  accessToken: string,
  query: PortfolioQuery,
  params: {
    shipsToCountry?: string;
    context?: CatalogSearchContext;
    limit: number;
    signal?: AbortSignal;
    onMcpAudit?: (event: EngineMcpAuditEvent) => void;
    dropCategory?: boolean;
    dropPriceMax?: boolean;
    brief?: SearchBrief;
    callKind?: EngineMcpCallKind;
    traceCatalogQueries?: boolean;
    traceWave?: string;
    /** Layer-1 taxonomy attribute prefilter (one primary query only). */
    taxonomyPrefilter?: boolean;
  },
): Promise<SingleQueryResult> {
  const hasLike = Boolean(query.like?.length);
  let gated: PortfolioQuery | null;
  if (hasLike && !query.text.trim()) {
    gated = query;
  } else if (params.brief != null) {
    gated = sanitizePortfolioQuery(query, params.brief);
    if (!gated && hasLike) {
      gated = { ...query, text: "" };
    }
  } else {
    gated = query.text.trim() ? query : hasLike ? { ...query, text: "" } : null;
  }
  if (!gated) {
    logAiChat("warn", "pool_query_rejected", {
      queryId: query.id,
      text: query.text.slice(0, 120),
    });
    if (params.traceCatalogQueries) {
      logFindSimilar("catalog_query_rejected", {
        wave: params.traceWave ?? "initial",
        queryId: query.id,
        text: query.text,
        like: query.like?.map((l) => ("id" in l ? l.id : "[image]")),
      });
    }
    return { query, products: [], loosened: Boolean(params.dropPriceMax) };
  }
  try {
    const filters = filtersForQuery(gated, params.shipsToCountry, {
      dropCategory: params.dropCategory,
      dropPriceMax: params.dropPriceMax,
      brief: params.brief,
      taxonomyPrefilter: params.taxonomyPrefilter,
    });
    const context = buildCatalogCallContext(
      filters,
      params.context,
      gated.intent ?? params.context?.intent,
    );
    let lastExchange: CatalogMcpExchange | null = null;
    const res = await searchCatalog(
      accessToken,
      gated.text,
      filters,
      {
        context,
        like: gated.like,
        limit: params.limit,
        signal: params.signal,
        onMcpExchange: (exchange) => {
          lastExchange = exchange;
        },
      },
    );
    const products = res.products ?? [];
    if (params.traceCatalogQueries) {
      logFindSimilar("catalog_query_ok", {
        wave: params.traceWave ?? "initial",
        queryId: gated.id,
        text: gated.text || null,
        like: gated.like?.map((l) => ("id" in l ? l.id : "[image]")),
        filters,
        context: params.context ?? null,
        rawCount: products.length,
        sampleTitles: products.slice(0, 3).map((p) => p.title),
      });
    }
    if (params.onMcpAudit && lastExchange) {
      params.onMcpAudit({
        exchange: lastExchange,
        callKind:
          params.callKind ??
          (params.dropPriceMax
            ? "portfolio_loosen"
            : params.dropCategory
              ? "portfolio_broaden"
              : "portfolio"),
        queryText: gated.text,
        portfolioQueryId: gated.id,
        effectiveInput: {
          query: gated.text,
          intent: gated.intent,
          filters,
          dropCategory: Boolean(params.dropCategory),
          dropPriceMax: Boolean(params.dropPriceMax),
        },
        products,
      });
    }
    return {
      query: gated,
      products,
      loosened: Boolean(params.dropPriceMax),
    };
  } catch (err) {
    const error = String(err).slice(0, 400);
    logAiChat("warn", "pool_query_failed", {
      queryId: query.id,
      text: query.text.slice(0, 120),
      error: error.slice(0, 200),
    });
    if (params.traceCatalogQueries) {
      logFindSimilar("catalog_query_failed", {
        wave: params.traceWave ?? "initial",
        queryId: query.id,
        text: query.text || null,
        like: query.like?.map((l) => ("id" in l ? l.id : "[image]")),
        error,
      });
    }
    return { query, products: [], loosened: Boolean(params.dropPriceMax) };
  }
}

/** Union per-query results into a UPID-deduped candidate map (mutates `map`). */
function foldResults(
  map: Map<string, PoolCandidate>,
  results: SingleQueryResult[],
  excludedKeys: Set<string>,
  statsByQuery: Map<string, QueryYieldStat>,
): void {
  for (const { query, products, loosened } of results) {
    const stat = statsByQuery.get(query.id);
    if (stat) stat.rawCount += products.length;
    for (let rank = 0; rank < products.length; rank++) {
      const product = products[rank]!;
      if (!productSearchSummaryInStock(product)) continue;
      const upid = productUpid(product);
      if (excludedKeys.has(upid) || excludedKeys.has(product.id)) continue;

      const source: QuerySource = {
        queryId: query.id,
        rank,
        isDiscovery: query.isDiscovery,
        directionLabel: query.directionLabel,
      };
      const existing = map.get(upid);
      if (existing) {
        existing.sources.push(source);
        existing.bestRank = Math.min(existing.bestRank, rank);
        existing.corroboration = new Set(
          existing.sources.map((s) => s.queryId),
        ).size;
        // A candidate counts as "from discovery" only if EVERY query that
        // surfaced it was a discovery query.
        existing.fromDiscovery = existing.sources.every((s) => s.isDiscovery);
        if (loosened) existing.loosened = true;
        if (!existing.directionLabel && query.directionLabel) {
          existing.directionLabel = query.directionLabel;
        }
      } else {
        map.set(upid, {
          product,
          upid,
          sources: [source],
          bestRank: rank,
          corroboration: 1,
          fromDiscovery: Boolean(query.isDiscovery),
          directionLabel: query.directionLabel,
          loosened,
        });
        const s = statsByQuery.get(query.id);
        if (s) s.poolContribution += 1;
      }
    }
  }
}

/** Supplement the pool with warm-stashed clarification preview hits (deduped by UPID). */
export function mergeWarmCandidatesIntoPool(
  candidates: PoolCandidate[],
  warmProducts: CatalogProductSummary[],
  excludedKeys: Set<string>,
): PoolCandidate[] {
  if (!warmProducts.length) return candidates;

  const map = new Map(candidates.map((c) => [c.upid, c]));

  for (let rank = 0; rank < warmProducts.length; rank++) {
    const product = warmProducts[rank]!;
    if (!productSearchSummaryInStock(product)) continue;
    const upid = productUpid(product);
    if (excludedKeys.has(upid) || excludedKeys.has(product.id)) continue;
    if (map.has(upid)) continue;

    map.set(upid, {
      product,
      upid,
      sources: [{ queryId: "warm_cache", rank, isDiscovery: false }],
      bestRank: rank,
      corroboration: 1,
      fromDiscovery: false,
      fromWarmCache: true,
    });
  }

  return [...map.values()];
}

export async function buildPool(params: {
  accessToken: string;
  queries: PortfolioQuery[];
  brief: SearchBrief;
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  /** UPIDs/ids of previously shown picks to exclude (refine rounds). */
  excludedKeys?: Set<string>;
  limit?: number;
  thinThreshold?: number;
  signal?: AbortSignal;
  onMcpAudit?: (event: EngineMcpAuditEvent) => void;
  /** Log each search_catalog call to the terminal (find-similar debug). */
  traceCatalogQueries?: boolean;
}): Promise<PoolResult> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const thinThreshold = params.thinThreshold ?? DEFAULT_THIN_THRESHOLD;
  const excludedKeys = params.excludedKeys ?? new Set<string>();

  const statsByQuery = new Map<string, QueryYieldStat>();
  for (const q of params.queries) {
    statsByQuery.set(q.id, {
      queryId: q.id,
      text: q.text,
      rawCount: 0,
      poolContribution: 0,
      isDiscovery: Boolean(q.isDiscovery),
      loosened: false,
    });
  }

  const map = new Map<string, PoolCandidate>();
  const trace = params.traceCatalogQueries;
  const queryTrace = {
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    excludedKeyCount: excludedKeys.size,
    traceCatalogQueries: trace,
  };

  if (trace) {
    logFindSimilar("pool_start", {
      ...queryTrace,
      queryCount: params.queries.length,
      thinThreshold,
      queries: params.queries.map((q) => ({
        id: q.id,
        text: q.text || null,
        like: q.like?.map((l) => ("id" in l ? l.id : "[image]")),
      })),
    });
  }

  // Wave: fire all portfolio queries in parallel.
  const taxonomyQueryId = params.queries.find((q) => !q.isDiscovery)?.id;
  const firstResults = await Promise.all(
    params.queries.map((q) =>
      runOneQuery(params.accessToken, q, {
        shipsToCountry: params.shipsToCountry,
        context: params.context,
        limit,
        signal: params.signal,
        onMcpAudit: params.onMcpAudit,
        brief: params.brief,
        traceCatalogQueries: trace,
        traceWave: "initial",
        taxonomyPrefilter: taxonomyQueryId != null && q.id === taxonomyQueryId,
      }),
    ),
  );
  foldResults(map, firstResults, excludedKeys, statsByQuery);

  // Discover the dominant taxonomy category for future tightening (cache only;
  // we don't re-query here to stay within the SLA unless the pool is thin).
  discoverDominantCategory(firstResults.flatMap((r) => r.products));

  let loosened = false;

  // Thin-pool widening ladder.
  if (map.size < thinThreshold && params.queries.length) {
    // Rung 1 — broaden: drop category GID + price.max on the top 2 queries.
    const broadenQueries = params.queries
      .filter((q) => q.categoryGid)
      .slice(0, 2);
    if (broadenQueries.length) {
      const broadened = await Promise.all(
        broadenQueries.map((q) =>
          runOneQuery(params.accessToken, q, {
            shipsToCountry: params.shipsToCountry,
            context: params.context,
            limit,
            signal: params.signal,
            onMcpAudit: params.onMcpAudit,
            dropCategory: true,
            brief: params.brief,
            traceCatalogQueries: trace,
            traceWave: "broaden",
          }),
        ),
      );
      foldResults(map, broadened, excludedKeys, statsByQuery);
    }
  }

  if (map.size < thinThreshold) {
    // Rung 2 — drop price.max (mark survivors loosened).
    const priceQueries = params.queries
      .filter((q) => q.priceMaxCents != null)
      .slice(0, 3);
    if (priceQueries.length) {
      const relaxed = await Promise.all(
        priceQueries.map((q) =>
          runOneQuery(params.accessToken, q, {
            shipsToCountry: params.shipsToCountry,
            context: params.context,
            limit,
            signal: params.signal,
            onMcpAudit: params.onMcpAudit,
            dropPriceMax: true,
            brief: params.brief,
            traceCatalogQueries: trace,
            traceWave: "relax_price",
          }),
        ),
      );
      foldResults(map, relaxed, excludedKeys, statsByQuery);
      loosened = relaxed.some((r) => r.products.length > 0);
    }
  }

  const candidates = [...map.values()];
  const thin = candidates.length < thinThreshold;
  if (thin) {
    logAiChat("info", "pool_thin", {
      size: candidates.length,
      queries: params.queries.length,
    });
  }

  if (trace) {
    logFindSimilar("pool_done", {
      candidateCount: candidates.length,
      thin,
      loosened,
      stats: [...statsByQuery.values()],
    });
  }

  return {
    candidates,
    stats: [...statsByQuery.values()],
    thin,
    loosened,
  };
}

/** Union two candidate pools by UPID (second pool wins on rank if better). */
export function mergePoolCandidates(
  primary: PoolCandidate[],
  extra: PoolCandidate[],
): PoolCandidate[] {
  const map = new Map<string, PoolCandidate>();
  for (const c of primary) map.set(c.upid, c);
  for (const c of extra) {
    const existing = map.get(c.upid);
    if (!existing || c.bestRank < existing.bestRank) {
      map.set(c.upid, {
        ...c,
        sources: [...(existing?.sources ?? []), ...c.sources],
        corroboration: (existing?.corroboration ?? 0) + c.corroboration,
      });
    }
  }
  return [...map.values()];
}
