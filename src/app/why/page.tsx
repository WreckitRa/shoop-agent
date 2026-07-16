import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { lookupWhyProduct } from "@/lib/qa/why-product";
import { SCORING_COMPONENT_KEYS } from "@/lib/fashion-memory/scoring/weights";

export const dynamic = "force-dynamic";

export default async function WhyPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; trace?: string }>;
}) {
  const q = await searchParams;
  const productRef = q.product?.trim() ?? "";
  const traceId = q.trace?.trim() || undefined;

  let error: string | null = null;
  let productId: string | null = null;
  let insights: Awaited<ReturnType<typeof lookupWhyProduct>>["insights"] = [];

  if (productRef) {
    const result = await lookupWhyProduct({ productRef, traceId });
    productId = result.productId;
    insights = result.insights;
    if (!productId) {
      error = "Could not resolve that product URL or id to a Shopify GID.";
    }
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl space-y-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">/why</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Paste a product GID or catalog URL to see pipeline outcome (survivor,
            drop rule, or curator exclusion).
          </p>
        </div>

        <form className="card space-y-3 p-4" action="/why" method="get">
          <label className="block text-sm font-medium text-ink" htmlFor="product">
            Product URL or GID
          </label>
          <input
            id="product"
            name="product"
            defaultValue={productRef}
            placeholder="gid://shopify/Product/… or https://…"
            className="w-full rounded-lg border border-hairline bg-page px-3 py-2 font-mono text-sm"
          />
          <label className="block text-sm font-medium text-ink" htmlFor="trace">
            Trace id (optional)
          </label>
          <input
            id="trace"
            name="trace"
            defaultValue={traceId ?? ""}
            placeholder="uuid from debug panel"
            className="w-full rounded-lg border border-hairline bg-page px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Look up
          </button>
        </form>

        {error ? (
          <div className="card border-red-200 bg-red-50/50 p-4 text-sm text-red-900">
            {error}
          </div>
        ) : null}

        {productId ? (
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Resolved product
            </p>
            <p className="mt-1 font-mono text-sm text-ink">{productId}</p>
          </div>
        ) : null}

        {insights.length === 0 && productId ? (
          <p className="text-sm text-ink-muted">
            No recent fashion run found for this product
            {traceId ? ` in trace ${traceId}` : ""}.
          </p>
        ) : null}

        {insights.map((insight) => (
          <div key={`${insight.messageId}-${insight.slot_id}-${insight.status}`} className="card p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-surface-subtle px-2 py-0.5 font-semibold uppercase">
                {insight.status}
              </span>
              {insight.garment ? <span>{insight.garment}</span> : null}
              {insight.traceId ? (
                <Link
                  href={`/admin/fashion/${insight.traceId}`}
                  className="font-mono text-brand hover:underline"
                >
                  trace {insight.traceId.slice(0, 8)}…
                </Link>
              ) : null}
            </div>

            {insight.drop ? (
              <p className="mt-2 text-sm text-ink">
                <span className="font-mono text-red-800">{insight.drop.rule}</span>
                {" — "}
                {insight.drop.evidence}
              </p>
            ) : null}

            {insight.score ? (
              <div className="mt-3">
                <p className="text-xs text-ink-muted">
                  final {insight.score.final.toFixed(4)}
                </p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {SCORING_COMPONENT_KEYS.map((key) => (
                    <li key={key} className="font-mono text-[11px] text-ink-muted">
                      {key}: {(insight.score!.components[key] ?? 0).toFixed(3)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
