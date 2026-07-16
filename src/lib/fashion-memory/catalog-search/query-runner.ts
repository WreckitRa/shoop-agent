import {
  buildCatalogCallContext,
  buildSearchCatalogRequest,
  CATALOG_SEARCH_PAGE_LIMIT,
  type CatalogProductSummary,
  type CatalogSearchContext,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import { resolveSearchCatalog } from "@/lib/shopify/catalog-client-override";
import {
  abortSignalWithTimeout,
  type AbortScope,
} from "@/lib/ai-chat/abort-scope";
import { logAiChat } from "@/lib/ai-chat/observability";
import { consumeQaFault } from "@/lib/qa/faults";
import { recordPipelineEvent } from "../observability/trace";
import { catalogSummaryToProductCard } from "./product-card";
import { pipelineProductFromSummary, serializeCatalogForDebug } from "@/lib/ai-chat/search/pipeline-debug";
import type { FashionCatalogPageCall } from "./fashion-catalog-debug";
import type { FashionCatalogQueryLog } from "./types";

function parseFashionCatalogQueryTimeoutMs(raw: string | undefined): number {
  // Observed healthy `search_catalog` latency on catalog.shopify.com is often
  // 15–20s under load; 12s was aborting successful-but-slow calls.
  const n = Number(raw ?? "25000");
  if (!Number.isFinite(n) || n < 2_000) return 25_000;
  return Math.min(Math.round(n), 60_000);
}

/** Per query-variant budget for Shopify MCP `search_catalog` (includes pagination). */
export const FASHION_CATALOG_QUERY_TIMEOUT_MS = parseFashionCatalogQueryTimeoutMs(
  process.env.FASHION_CATALOG_QUERY_TIMEOUT_MS,
);
export const FASHION_CATALOG_TARGET_RESULTS = 100;

export type RunCatalogQueryParams = {
  accessToken: string;
  query: string;
  filters: CatalogSearchFilters;
  buyerContext: CatalogSearchContext;
  intent?: string;
  signal?: AbortSignal;
  abortScope?: AbortScope;
  slotId: string;
  variantIndex: number;
  reformulation?: boolean;
  traceId?: string | null;
};

export type RunCatalogQueryResult = {
  products: CatalogProductSummary[];
  log: FashionCatalogQueryLog;
  catalogById: Record<string, Record<string, unknown>>;
};

export async function runCatalogQueryWithTimeout(
  params: RunCatalogQueryParams,
): Promise<RunCatalogQueryResult> {
  const started = Date.now();

  if (
    params.variantIndex === 0 &&
    consumeQaFault(null, "fail_one_lane", params.traceId, {
      slot_id: params.slotId,
      variant_index: params.variantIndex,
      query: params.query.slice(0, 120),
    })
  ) {
    const log: FashionCatalogQueryLog = {
      slot_id: params.slotId,
      variant_index: params.variantIndex,
      query: params.query,
      reformulation: params.reformulation ?? false,
      status: "failed",
      raw_count: 0,
      duration_ms: Date.now() - started,
      error: "qa_fault:fail_one_lane",
    };
    return { products: [], log, catalogById: {} };
  }

  const opSignal = params.abortScope?.fork();
  const deadline = abortSignalWithTimeout(
    opSignal,
    FASHION_CATALOG_QUERY_TIMEOUT_MS,
  );
  const progress: FetchProgress = { pagesCompleted: 0, lastHttpStatus: null };

  try {
    const { products, catalogCalls, partialTimeout } = await fetchCatalogQueryProducts(
      {
        accessToken: params.accessToken,
        query: params.query,
        filters: params.filters,
        buyerContext: params.buyerContext,
        intent: params.intent,
        signal: deadline,
      },
      progress,
    );

    const debugProducts = products.map(pipelineProductFromSummary);
    const product_cards = products.map(catalogSummaryToProductCard);
    const catalogById: Record<string, Record<string, unknown>> = {};
    for (const product of products) {
      const id = product.id?.trim();
      if (!id || catalogById[id]) continue;
      catalogById[id] = serializeCatalogForDebug(product);
    }

    const log: FashionCatalogQueryLog = {
      slot_id: params.slotId,
      variant_index: params.variantIndex,
      query: params.query,
      reformulation: params.reformulation ?? false,
      status: "ok",
      raw_count: products.length,
      duration_ms: Date.now() - started,
      catalog_calls: catalogCalls,
      products: debugProducts,
      product_cards,
      ...(partialTimeout
        ? { error: "pagination_stopped_early: query timeout budget exhausted" }
        : {}),
    };

    logAiChat("info", "fashion_catalog_query_ok", {
      slot_id: params.slotId,
      variant_index: params.variantIndex,
      query: params.query.slice(0, 120),
      raw_count: products.length,
      fetch_cap: FASHION_CATALOG_TARGET_RESULTS,
      duration_ms: log.duration_ms,
      reformulation: log.reformulation,
    });

    return { products, log, catalogById };
  } catch (err) {
    const elapsed = Date.now() - started;
    const parentAborted = params.signal?.aborted === true;
    const deadlineHit =
      deadline.aborted &&
      !parentAborted &&
      elapsed >= FASHION_CATALOG_QUERY_TIMEOUT_MS - 50;

    // Classify *why* a variant failed so hangs are distinguishable from
    // upstream errors and caller/user aborts:
    //   upstream_unreachable — deadline hit with 0 pages returned (connect/DNS/TLS
    //                          hang or endpoint never responding; raising the
    //                          timeout won't help).
    //   upstream_slow        — deadline hit after ≥1 page came back (endpoint is
    //                          reachable but too slow to paginate in budget).
    //   parent_abort         — the caller/user signal aborted (e.g. navigation).
    //   upstream_error       — a non-timeout throw (HTTP error, parse, etc.).
    const failureKind = deadlineHit
      ? progress.pagesCompleted > 0
        ? "upstream_slow"
        : "upstream_unreachable"
      : parentAborted
        ? "parent_abort"
        : "upstream_error";

    const log: FashionCatalogQueryLog = {
      slot_id: params.slotId,
      variant_index: params.variantIndex,
      query: params.query,
      reformulation: params.reformulation ?? false,
      status: deadlineHit ? "timeout" : "failed",
      raw_count: 0,
      duration_ms: elapsed,
      error: String(err).slice(0, 240),
    };

    logAiChat("warn", "fashion_catalog_query_failed", {
      slot_id: params.slotId,
      variant_index: params.variantIndex,
      query: params.query.slice(0, 120),
      status: log.status,
      failure_kind: failureKind,
      pages_completed: progress.pagesCompleted,
      last_http_status: progress.lastHttpStatus,
      timeout_ms: FASHION_CATALOG_QUERY_TIMEOUT_MS,
      duration_ms: log.duration_ms,
      error: log.error,
    });

    recordPipelineEvent({
      traceId: params.traceId,
      stage: "catalog_query_failed",
      payload: {
        slot_id: params.slotId,
        variant_index: params.variantIndex,
        query: params.query.slice(0, 120),
        status: log.status,
        failure_kind: failureKind,
        pages_completed: progress.pagesCompleted,
        last_http_status: progress.lastHttpStatus,
        error: log.error,
      },
    });

    return { products: [], log, catalogById: {} };
  }
}

/** Mutable progress tracker so the caller can classify a timeout precisely. */
type FetchProgress = {
  /** Count of `search_catalog` pages that actually returned a response. */
  pagesCompleted: number;
  /** HTTP status of the most recent MCP round-trip (null until first response). */
  lastHttpStatus: number | null;
};

/** Up to 100 results (2×50 pages) — never paginate beyond that. */
async function fetchCatalogQueryProducts(
  params: {
    accessToken: string;
    query: string;
    filters: CatalogSearchFilters;
    buyerContext: CatalogSearchContext;
    intent?: string;
    signal?: AbortSignal;
  },
  progress: FetchProgress,
): Promise<{
  products: CatalogProductSummary[];
  catalogCalls: FashionCatalogPageCall[];
  partialTimeout?: boolean;
}> {
  const context = buildCatalogCallContext(
    params.filters,
    params.buyerContext,
    params.intent,
  );

  const out: CatalogProductSummary[] = [];
  const catalogCalls: FashionCatalogPageCall[] = [];
  let cursor: string | undefined;
  let page = 0;
  let partialTimeout = false;

  try {
    while (out.length < FASHION_CATALOG_TARGET_RESULTS) {
      const request = buildSearchCatalogRequest(
        params.query,
        params.filters,
        {
          context,
          limit: CATALOG_SEARCH_PAGE_LIMIT,
          cursor,
        },
      );

      const res = await resolveSearchCatalog()(
        params.accessToken,
        params.query,
        params.filters,
        {
          context,
          limit: CATALOG_SEARCH_PAGE_LIMIT,
          cursor,
          signal: params.signal,
          onMcpExchange: (exchange) => {
            progress.lastHttpStatus = exchange.httpStatus;
          },
        },
      );
      progress.pagesCompleted += 1;

      const pageProducts = res.products ?? [];
      out.push(...pageProducts);

      const pagination = res.pagination;
      const hasNext = pagination?.has_next_page === true;
      cursor = pagination?.cursor?.trim() || undefined;

      catalogCalls.push({
        page,
        request,
        product_count: pageProducts.length,
        has_next_page: hasNext,
      });
      page += 1;

      if (
        !hasNext ||
        !cursor ||
        pageProducts.length === 0 ||
        out.length >= FASHION_CATALOG_TARGET_RESULTS
      ) {
        break;
      }
    }
  } catch (err) {
    if (out.length > 0 && params.signal?.aborted) {
      partialTimeout = true;
    } else {
      throw err;
    }
  }

  return {
    products: out.slice(0, FASHION_CATALOG_TARGET_RESULTS),
    catalogCalls,
    partialTimeout,
  };
}
