"use client";

import { memo } from "react";
import { cn } from "@/lib/ai-chat/cn";
import type { FashionCatalogRunView } from "@/lib/ai-chat/agent-debug";
import type { PipelineDebugProduct } from "@/lib/ai-chat/search/pipeline-debug";
import {
  CATALOG_IMAGE_PX,
  catalogDisplayImageUrl,
} from "@/lib/shopify/catalog-display-image";

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function QueryStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        status === "ok" && "bg-emerald-500/20 text-emerald-900 dark:text-emerald-100",
        status === "timeout" && "bg-amber-500/20 text-amber-950 dark:text-amber-50",
        status !== "ok" &&
          status !== "timeout" &&
          "bg-red-500/20 text-red-800 dark:text-red-100",
      )}
    >
      {status}
    </span>
  );
}

function ProductRow({ product }: { product: PipelineDebugProduct }) {
  return (
    <li className="flex gap-2 rounded-md border border-border/60 bg-surface-subtle/50 p-2">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogDisplayImageUrl(product.imageUrl, CATALOG_IMAGE_PX.debug)}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="size-12 shrink-0 rounded bg-surface-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink">{product.title}</p>
        <p className="truncate text-[10px] text-ink-muted">
          {[product.store, product.priceLabel, product.ratingLabel]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="truncate font-mono text-[10px] text-ink-muted">{product.id}</p>
      </div>
    </li>
  );
}

export const FashionCatalogDebugPanel = memo(function FashionCatalogDebugPanel({
  run,
}: {
  run: FashionCatalogRunView;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-ink-muted">
        <span className="rounded bg-teal-500/15 px-1.5 py-0.5 font-mono uppercase tracking-wide text-teal-900 dark:text-teal-100">
          {run.mode}
        </span>
        <span>{run.total_queries} queries</span>
        <span>{run.total_products_fetched} raw hits</span>
        <span>{run.timing_ms}ms</span>
      </div>

      {run.slots.map((slot) => (
        <section key={slot.slot_id} className="mb-6">
          <h3 className="text-sm font-semibold text-ink">
            {slot.garment}{" "}
            <span className="font-normal text-ink-muted">
              ({slot.unique_products} unique ·{" "}
              {slot.reformulated ? "reformulated" : "planner only"})
            </span>
          </h3>

          {slot.queries.map((query) => (
            <div
              key={`${slot.slot_id}-${query.variant_index}-${query.query}`}
              className="mt-3 rounded-lg border border-border/70 bg-page/40 p-2.5"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-ink-muted">
                  v{query.variant_index}
                </span>
                <QueryStatusBadge status={query.status} />
                {query.reformulation ? (
                  <span className="text-[10px] text-ink-muted">reformulation</span>
                ) : null}
                <span className="text-[10px] text-ink-muted">
                  {query.raw_count} products · {query.duration_ms}ms
                </span>
              </div>

              <p className="mb-2 font-mono text-xs text-ink">{query.query}</p>

              {(query.catalog_calls ?? []).map((call) => (
                <details key={call.page} className="mb-2" open={call.page === 0}>
                  <summary className="cursor-pointer text-[11px] font-medium text-ink">
                    search_catalog page {call.page + 1} · {call.product_count} hits
                    {call.has_next_page ? " · has next" : ""}
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                    {formatJson({ catalog: call.request })}
                  </pre>
                </details>
              ))}

              {query.error ? (
                <p className="mb-2 text-xs text-red-600 dark:text-red-300">{query.error}</p>
              ) : null}

              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Products ({query.products.length})
              </p>
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {query.products.map((product) => (
                  <ProductRow key={`${query.variant_index}-${product.id}`} product={product} />
                ))}
              </ul>

              {Object.keys(run.catalogById).length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-ink-muted">
                    Expand raw Shopify JSON (sample ids in pool)
                  </summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] text-ink-muted">
                    {formatJson(
                      Object.fromEntries(
                        query.products
                          .slice(0, 3)
                          .map((p) => [p.id, run.catalogById[p.id] ?? null]),
                      ),
                    )}
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
});
