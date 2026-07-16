import type { PipelineDebugProduct } from "@/lib/ai-chat/search/pipeline-debug";
import {
  pipelineProductFromSummary,
  serializeCatalogForDebug,
} from "@/lib/ai-chat/search/pipeline-debug";
import type {
  FashionCatalogQueryLog,
  FashionCatalogSearchResult,
  FashionCatalogPageCall,
  FashionSlotCatalogResult,
} from "./types";

export type { FashionCatalogPageCall } from "./types";

export type FashionCatalogQueryDebug = FashionCatalogQueryLog & {
  catalog_calls: FashionCatalogPageCall[];
  products: PipelineDebugProduct[];
};

export type FashionCatalogSlotDebug = {
  slot_id: string;
  garment: string;
  unique_products: number;
  reformulated: boolean;
  queries: FashionCatalogQueryDebug[];
  /** Deduped slot pool for quick scan. */
  pool: PipelineDebugProduct[];
};

export type FashionCatalogDebugV1 = {
  version: 1;
  searchKey: string;
  ts: number;
  trace_id?: string;
  timing_ms: number;
  mode: string;
  slots: FashionCatalogSlotDebug[];
  /** Full Shopify payloads keyed by product id (expand view). */
  catalogById: Record<string, Record<string, unknown>>;
  total_queries: number;
  total_products_fetched: number;
};

function slotDebugFromResult(
  slot: FashionSlotCatalogResult,
  catalogById: Record<string, Record<string, unknown>>,
): FashionCatalogSlotDebug {
  const queries: FashionCatalogQueryDebug[] = (slot.query_logs ?? []).map((log) => {
    const products = log.products ?? [];
    return {
      ...log,
      catalog_calls: log.catalog_calls ?? [],
      products,
    };
  });

  const pool = slot.products.map((p) => pipelineProductFromSummary(p.raw));
  for (const p of slot.products) {
    const id = p.raw.id?.trim();
    if (!id || catalogById[id]) continue;
    catalogById[id] = serializeCatalogForDebug(p.raw);
  }
  for (const q of queries) {
    for (const p of q.products) {
      const raw = slot.products.find((sp) => sp.id === p.id)?.raw;
      if (!raw) continue;
      const id = raw.id?.trim();
      if (!id || catalogById[id]) continue;
      catalogById[id] = serializeCatalogForDebug(raw);
    }
  }

  return {
    slot_id: slot.slot_id,
    garment: slot.garment,
    unique_products: slot.counts.unique_products,
    reformulated: slot.counts.reformulated,
    queries,
    pool,
  };
}

export function buildFashionCatalogDebug(
  result: FashionCatalogSearchResult,
  ts = Date.now(),
  traceId?: string | null,
): FashionCatalogDebugV1 {
  const catalogById: Record<string, Record<string, unknown>> = {};
  const slots = result.slots.map((slot) => {
    Object.assign(catalogById, slot.catalog_by_id ?? {});
    return slotDebugFromResult(slot, catalogById);
  });
  const total_queries = slots.reduce((n, s) => n + s.queries.length, 0);
  const total_products_fetched = slots.reduce(
    (n, s) => n + s.queries.reduce((m, q) => m + q.products.length, 0),
    0,
  );

  const garmentLabel =
    result.plan.slots.map((s) => s.garment).join(", ") || "fashion";

  return {
    version: 1,
    searchKey: `fashion:${garmentLabel}:${ts}`,
    ts,
    ...(traceId ? { trace_id: traceId } : {}),
    timing_ms: result.timing_ms,
    mode: result.plan.mode,
    slots,
    catalogById,
    total_queries,
    total_products_fetched,
  };
}

export function fashionCatalogDebugFromSse(
  data: Record<string, unknown>,
): FashionCatalogDebugV1 | null {
  if (data.version !== 1) return null;
  if (!Array.isArray(data.slots)) return null;
  return data as FashionCatalogDebugV1;
}

/** Strip heavy catalog blobs before localStorage persistence. */
export function fashionCatalogDebugForPersist(
  run: FashionCatalogDebugV1,
): FashionCatalogDebugV1 {
  return {
    ...run,
    catalogById: {},
    slots: run.slots.map((slot) => ({
      ...slot,
      queries: slot.queries.map((q) => ({
        ...q,
        products: q.products,
        catalog_calls: q.catalog_calls,
      })),
    })),
  };
}
