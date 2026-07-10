"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import type { FashionCatalogRunDetail } from "@/lib/admin/fashion-types";
import type { FashionSlotCatalogProduct } from "@/lib/fashion-memory/catalog-search/types";
import type { ProductScore } from "@/lib/fashion-memory/scoring/types";

type Tab = "survivors" | "dropped" | "pipeline" | "overview";

function ScoreBar({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-ink-muted">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-subtle">
        <div
          className={cn("h-full rounded-full", muted ? "bg-ink-muted/50" : "bg-brand")}
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

function ProductScorePanel({ score }: { score: ProductScore }) {
  const c = score.components;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-hairline bg-surface-tint/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Score breakdown
        </span>
        <span className="font-mono text-sm font-semibold text-ink">
          final {score.final.toFixed(4)}
        </span>
      </div>
      <ScoreBar label="Shopify rank" value={c.shopify_rank} />
      <ScoreBar label="Corroboration" value={c.corroboration} />
      <ScoreBar label="Size confirmed" value={c.size_confirmed} />
      <ScoreBar label="Rating" value={c.rating} />
      <ScoreBar label="Palette" value={c.palette} />
      {score.penalties_applied > 0 ? (
        <p className="text-xs text-amber-800">
          Suspicion penalty: −{score.penalties_applied.toFixed(3)}
        </p>
      ) : null}
      <p className="text-[10px] text-ink-muted">
        Active: {score.active_components.join(", ")} · weights {score.weights_version}
      </p>
    </div>
  );
}

function SurvivorRow({
  rank,
  product,
}: {
  rank: number;
  product: FashionSlotCatalogProduct;
}) {
  return (
    <details className="group rounded-xl border border-hairline bg-page open:bg-surface-tint/30">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 font-mono text-xs font-bold text-brand">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{product.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-muted">{product.id}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-ink-muted">
            {product.score ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-900">
                {product.score.final.toFixed(4)}
              </span>
            ) : null}
            {product.matched_by.length > 1 ? (
              <span>{product.matched_by.length} variants</span>
            ) : null}
            {(product.suspicions?.length ?? 0) > 0 ? (
              <span className="text-amber-800">
                {product.suspicions!.length} suspicion
                {product.suspicions!.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </div>
      </summary>
      <div className="border-t border-hairline px-4 pb-4">
        {product.score ? <ProductScorePanel score={product.score} /> : null}
        {product.suspicions?.length ? (
          <ul className="mt-3 space-y-1 text-xs text-ink-muted">
            {product.suspicions.map((s, i) => (
              <li key={`${s.rule}-${i}`}>
                <span className="font-mono text-amber-900">{s.rule}</span>
                {s.evidence ? ` — ${s.evidence}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {product.normalized ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-surface-subtle p-2 font-mono text-[10px] text-ink-muted">
            {JSON.stringify(product.normalized, null, 2)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function formatDropRules(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const parts = Object.entries(raw as Record<string, number>)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}: ${n}`);
  return parts.join(", ");
}

function formatScoreDist(raw: unknown, key: string): string {
  if (!raw || typeof raw !== "object") return "—";
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === "number" ? v.toFixed(3) : "—";
}

function MetricCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-tint/50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </p>
      {lines.filter(Boolean).map((line) => (
        <p key={line} className="mt-1 font-mono text-xs text-ink">
          {line}
        </p>
      ))}
    </div>
  );
}

function SlotMetricsFromEvents({
  events,
  slotId,
  garment,
}: {
  events: FashionCatalogRunDetail["pipelineEvents"];
  slotId: string;
  garment: string;
}) {
  const hardDrop = events.find(
    (e) =>
      e.stage === "hard_drops" &&
      (e.payload.slot_id === slotId || e.payload.garment === garment),
  );
  const scoring = events.find(
    (e) =>
      e.stage === "scoring" &&
      (e.payload.slot_id === slotId || e.payload.garment === garment),
  );
  const normalize = events.find((e) => e.stage === "normalize");

  if (!hardDrop && !scoring) return null;

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      {normalize ? (
        <MetricCard
          title="Normalize"
          lines={[
            `labels ${String(normalize.payload.labels_total ?? "—")}`,
            `${String(normalize.payload.ms ?? "—")}ms`,
          ]}
        />
      ) : null}
      {hardDrop ? (
        <MetricCard
          title="Hard drops"
          lines={[
            `${String(hardDrop.payload.in ?? "?")} → ${String(hardDrop.payload.out ?? "?")}`,
            `${String(hardDrop.payload.ms ?? "—")}ms`,
            formatDropRules(hardDrop.payload.drops_by_rule),
          ]}
        />
      ) : null}
      {scoring ? (
        <MetricCard
          title="Scoring"
          lines={[
            `p50 ${formatScoreDist(scoring.payload.score_distribution, "p50")}`,
            `rated ${String((scoring.payload.component_coverage as { rated?: number })?.rated ?? "—")}`,
            `${String(scoring.payload.ms ?? "—")}ms`,
          ]}
        />
      ) : null}
    </div>
  );
}

export function FashionAdminTraceView({ detail }: { detail: FashionCatalogRunDetail }) {
  const [tab, setTab] = useState<Tab>("survivors");
  const [slotIndex, setSlotIndex] = useState(0);

  const slot = detail.catalogSearch.slots[slotIndex];
  const dropped = slot?.dropped ?? [];
  const survivors =
    slot?.verified_pool?.length
      ? slot.verified_pool
      : (slot?.products ?? []);

  const pipelineStages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of detail.pipelineEvents) {
      counts.set(e.stage, (counts.get(e.stage) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [detail.pipelineEvents]);

  const backHref = "/admin/fashion";
  const traceHref = detail.run.traceId
    ? `/admin/fashion/${detail.run.traceId}`
    : backHref;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={backHref}
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-brand"
          >
            <ArrowLeft className="size-3.5" />
            All runs
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {slot?.garment ?? "Fashion run"}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {detail.run.garments.join(" · ")} · {detail.catalogSearch.timing_ms}ms catalog
          </p>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-ink-muted">
            {detail.run.traceId ? <span>trace {detail.run.traceId}</span> : null}
            <span>msg {detail.run.messageId || "—"}</span>
            <Link href={`/c/${detail.run.conversationId}`} className="text-brand hover:underline">
              chat
            </Link>
          </div>
        </div>
        {detail.run.flagged ? (
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-950">
            Pipeline invariant flagged
          </span>
        ) : null}
      </div>

      {detail.catalogSearch.slots.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {detail.catalogSearch.slots.map((s, i) => (
            <button
              key={s.slot_id}
              type="button"
              onClick={() => setSlotIndex(i)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                i === slotIndex
                  ? "bg-brand text-white"
                  : "border border-hairline bg-page text-ink hover:bg-surface-tint",
              )}
            >
              {s.garment}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-hairline pb-px">
        {(
          [
            ["survivors", `Survivors (${survivors.length})`],
            ["dropped", `Dropped (${dropped.length})`],
            ["pipeline", "Pipeline"],
            ["overview", "Overview"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-t-lg px-4 py-2 text-sm font-medium transition",
              tab === id
                ? "border border-b-0 border-hairline bg-page text-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "survivors" && slot ? (
        <div className="space-y-3">
          <SlotMetricsFromEvents
            events={detail.pipelineEvents}
            slotId={slot.slot_id}
            garment={slot.garment}
          />
          <p className="text-xs text-ink-muted">
            Ranked by final score (desc). Expand a row for component breakdown.
          </p>
          {survivors.map((product, i) => (
            <SurvivorRow key={product.id} rank={i + 1} product={product} />
          ))}
        </div>
      ) : null}

      {tab === "dropped" && slot ? (
        <div className="space-y-3">
          {dropped.length === 0 ? (
            <div className="card px-6 py-10 text-center text-sm text-ink-muted">
              No hard drops in this slot — every retrieved product survived.
            </div>
          ) : (
            dropped.map((drop) => (
              <div
                key={`${drop.product_id}-${drop.rule}`}
                className="rounded-xl border border-red-200/80 bg-red-50/40 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-red-500/15 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-red-900">
                    {drop.rule}
                  </span>
                  <span className="font-mono text-xs text-ink-muted">{drop.product_id}</span>
                </div>
                <p className="mt-2 text-sm text-ink">{drop.evidence}</p>
              </div>
            ))
          )}
          {(slot.curator_exclusions?.length ?? 0) > 0 ? (
            <div className="card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Curator exclusions (not dropped)
              </p>
              <ul className="mt-2 list-inside list-disc text-sm text-ink">
                {slot.curator_exclusions!.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "pipeline" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {pipelineStages.map(([stage, count]) => (
              <span
                key={stage}
                className="rounded-full border border-hairline bg-surface-tint px-2.5 py-1 font-mono text-[10px] text-ink"
              >
                {stage} ×{count}
              </span>
            ))}
          </div>
          {detail.pipelineEvents.map((event) => (
            <details key={event.id} className="card overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">
                <span className="font-mono text-brand">{event.stage}</span>
                <span className="ml-3 text-xs text-ink-muted">{event.created_at}</span>
              </summary>
              <pre className="max-h-80 overflow-auto border-t border-hairline bg-surface-subtle p-4 font-mono text-[11px] leading-relaxed text-ink-muted">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </details>
          ))}
          {detail.pipelineEvents.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No pipeline events in Supabase for this trace. Check that Supabase is configured
              and the trace UUID is valid.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-ink">Trace summary</h2>
            <pre className="mt-2 max-h-64 overflow-auto font-mono text-[11px] text-ink-muted">
              {JSON.stringify(detail.trace?.summary ?? detail.run, null, 2)}
            </pre>
          </div>
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-ink">Search plan</h2>
            <pre className="mt-2 max-h-64 overflow-auto font-mono text-[11px] text-ink-muted">
              {JSON.stringify(detail.fashionSearchPlan ?? {}, null, 2)}
            </pre>
          </div>
          <div className="card p-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-ink">Router brief</h2>
            <pre className="mt-2 max-h-64 overflow-auto font-mono text-[11px] text-ink-muted">
              {JSON.stringify(detail.fashionRouter?.brief ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}

      <p className="text-[10px] text-ink-muted">
        Inspect URL:{" "}
        <Link href={traceHref} className="font-mono text-brand hover:underline">
          {traceHref}
        </Link>
      </p>
    </div>
  );
}
