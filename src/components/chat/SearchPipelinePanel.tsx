"use client";

import { memo, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import type {
  PipelineDebugProduct,
  PipelineDebugDrop,
  PipelineHeadToHeadRow,
  PipelineJourneyRow,
  PipelineListingHygieneRow,
  PipelinePreVerifyProduct,
  PipelineSlotRow,
  PipelineTriageRow,
  PipelineVerifySnapshot,
  SearchPipelineDebugV1,
  DropStageFilter,
} from "@/lib/ai-chat/search/pipeline-debug";
import {
  availableDropStageFilters,
  countJourneyRowsForDropFilter,
  dropStageFilterLabel,
  dropStageLabel,
  journeyRowMatchesDropFilter,
} from "@/lib/ai-chat/search/pipeline-debug";

const SLOT_LABEL: Record<string, string> = {
  shoop_pick: "Shoop's pick",
  best_value: "Best value",
  most_popular: "Most popular",
  gem: "Hidden gem",
  gallery: "Gallery",
  loosened: "Relaxed match",
  reframed: "Broader angle",
};

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "violet";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tone === "good" && "bg-emerald-500/20 text-emerald-900 dark:text-emerald-100",
        tone === "bad" && "bg-red-500/20 text-red-800 dark:text-red-100",
        tone === "warn" && "bg-amber-500/20 text-amber-950 dark:text-amber-50",
        tone === "violet" && "bg-violet-500/20 text-violet-900 dark:text-violet-100",
        tone === "neutral" && "bg-surface-subtle text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}

function formatSizeResolutionLines(
  resolution: PipelineDebugDrop["sizeResolution"],
): string[] {
  if (!resolution) return [];
  const lines: string[] = [`Size gate: ${resolution.status}`];
  if (resolution.method) lines.push(`Match method: ${resolution.method}`);
  if (resolution.merchantLabel) {
    lines.push(`Resolved label: ${resolution.merchantLabel}`);
  }
  if (resolution.parsedListingSize) {
    lines.push(`Listing size: ${resolution.parsedListingSize}`);
  }
  if (resolution.confidence != null) {
    lines.push(`Confidence: ${(resolution.confidence * 100).toFixed(0)}%`);
  }
  return lines;
}

function formatVerifySnapshotLines(
  snapshot: PipelineVerifySnapshot | undefined,
): string[] {
  if (!snapshot) return [];
  const lines: string[] = [
    `Verify source: ${snapshot.source}`,
    snapshot.resolvedPriceLabel
      ? `Live variant price: ${snapshot.resolvedPriceLabel}`
      : "Live variant price: unknown",
    `Budget (${snapshot.budget.type}): ${snapshot.budget.currency ?? "USD"} ${snapshot.budget.targetCents != null ? (snapshot.budget.targetCents / 100).toFixed(2) : "—"}`,
    snapshot.budget.summary,
  ];
  if (snapshot.selectedRequested?.length) {
    lines.push(
      `Requested options: ${snapshot.selectedRequested.map((o) => `${o.name}=${o.label}`).join(", ")}`,
    );
  }
  if (snapshot.resolvedOptions?.length) {
    lines.push(
      `Resolved options: ${snapshot.resolvedOptions.map((o) => `${o.name}=${o.label}`).join(", ")}`,
    );
  }
  return lines;
}

function ReasonBlock({
  label,
  text,
  tone = "default",
}: {
  label: string;
  text: string;
  tone?: "default" | "drop" | "slot";
}) {
  return (
    <div
      className={cn(
        "mt-2 rounded-md border px-2.5 py-2",
        tone === "drop" && "border-red-500/30 bg-red-500/5",
        tone === "slot" && "border-violet-500/30 bg-violet-500/5",
        tone === "default" && "border-border/70 bg-surface-subtle/80",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink">{text}</p>
    </div>
  );
}

function ProductDebugCard({
  product,
  catalogById,
  getProductById,
  badges,
  metaLines,
  reason,
  reasonLabel = "Why",
  reasonTone = "default",
  score,
  scoreBreakdown,
  verifySnapshot,
  children,
}: {
  product: PipelineDebugProduct;
  catalogById: Record<string, Record<string, unknown>>;
  getProductById?: Record<string, Record<string, unknown>>;
  badges?: React.ReactNode;
  metaLines?: string[];
  reason?: string;
  reasonLabel?: string;
  reasonTone?: "default" | "drop" | "slot";
  score?: number;
  scoreBreakdown?: Record<string, number>;
  verifySnapshot?: PipelineVerifySnapshot;
  children?: React.ReactNode;
}) {
  const [shopifyOpen, setShopifyOpen] = useState(false);
  const [getProductOpen, setGetProductOpen] = useState(false);
  const shopify = useMemo(() => {
    const direct = catalogById[product.id];
    if (direct) return direct;
    const suffix = product.id.split("/").pop();
    if (suffix && catalogById[suffix]) return catalogById[suffix];
    for (const [id, payload] of Object.entries(catalogById)) {
      if (id.endsWith(product.id) || product.id.endsWith(id)) return payload;
    }
    return null;
  }, [catalogById, product.id]);

  const getProduct = useMemo(() => {
    if (!getProductById) return null;
    const direct = getProductById[product.id];
    if (direct) return direct;
    const suffix = product.id.split("/").pop();
    if (suffix && getProductById[suffix]) return getProductById[suffix];
    for (const [id, payload] of Object.entries(getProductById)) {
      if (id.endsWith(product.id) || product.id.endsWith(id)) return payload;
    }
    return null;
  }, [getProductById, product.id]);

  const verifyLines = formatVerifySnapshotLines(verifySnapshot);
  const meta = [
    product.store ? `Store: ${product.store}` : null,
    product.priceLabel ? `Search price: ${product.priceLabel}` : null,
    product.ratingLabel ? `Rating: ${product.ratingLabel}` : null,
    score != null ? `Score: ${score.toFixed(2)}` : null,
    ...verifyLines,
    ...(metaLines ?? []),
  ].filter(Boolean) as string[];

  return (
    <li className="shrink-0 list-none rounded-lg border border-border/70 bg-surface shadow-sm">
      <div className="flex gap-3 p-3">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            className="size-14 shrink-0 rounded-lg border border-border/60 object-cover bg-surface-subtle"
          />
        ) : (
          <div className="size-14 shrink-0 rounded-lg border border-border/60 bg-surface-subtle" />
        )}
        <div className="min-w-0 flex-1 overflow-visible">
          <div className="flex flex-wrap items-start gap-2">
            <h4 className="min-w-0 flex-1 text-[14px] font-semibold leading-normal text-ink">
              {product.title}
            </h4>
            {badges}
          </div>
          {meta.length ? (
            <ul className="mt-1.5 space-y-1">
              {meta.map((line) => (
                <li key={line} className="text-[12px] leading-normal text-ink-muted">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {reason ? (
            <ReasonBlock label={reasonLabel} text={reason} tone={reasonTone} />
          ) : null}
          {children}
        </div>
      </div>

      <div className="border-t border-border/60 bg-surface-subtle/30">
        <button
          type="button"
          onClick={() => setShopifyOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left text-[12px] font-medium text-ink hover:bg-surface-subtle/60"
        >
          <span>Search catalog data</span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-ink-muted transition-transform",
              shopifyOpen && "rotate-180",
            )}
          />
        </button>
        {shopifyOpen ? (
          <div className="border-t border-border/50 px-3 py-2">
            <p className="mb-2 break-all font-mono text-[10px] leading-normal text-ink-muted">
              {product.id}
            </p>
            {scoreBreakdown && Object.keys(scoreBreakdown).length ? (
              <div className="mb-2 rounded-md border border-border/60 bg-surface">
                <p className="border-b border-border/50 px-2 py-1.5 text-[11px] font-medium text-ink">
                  Score breakdown
                </p>
                <pre className="max-h-40 overflow-auto px-2 py-2 font-mono text-[11px] leading-relaxed text-ink-muted">
                  {formatJson(scoreBreakdown)}
                </pre>
              </div>
            ) : null}
            {shopify ? (
              <pre className="max-h-80 overflow-auto rounded-md border border-border/60 bg-surface p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
                {formatJson(shopify)}
              </pre>
            ) : (
              <p className="text-[12px] leading-normal text-ink-muted">
                No raw catalog payload captured for this product id.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {(getProduct || verifySnapshot) && getProductById ? (
        <div className="border-t border-border/60 bg-surface-subtle/20">
          <button
            type="button"
            onClick={() => setGetProductOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left text-[12px] font-medium text-ink hover:bg-surface-subtle/60"
          >
            <span>get_product response</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-ink-muted transition-transform",
                getProductOpen && "rotate-180",
              )}
            />
          </button>
          {getProductOpen ? (
            <div className="border-t border-border/50 px-3 py-2">
              {getProduct ? (
                <pre className="max-h-80 overflow-auto rounded-md border border-border/60 bg-surface p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
                  {formatJson(getProduct)}
                </pre>
              ) : (
                <p className="text-[12px] leading-normal text-ink-muted">
                  No live get_product payload — product was not verified or verify
                  failed before catalog returned a product.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Section({
  title,
  subtitle,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="shrink-0 rounded-xl border border-border/70 bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-start justify-between gap-2 px-4 py-3 text-left hover:bg-surface-subtle/40"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-normal text-ink">{title}</p>
          {subtitle ? (
            <p className="mt-1 text-[12px] leading-normal text-ink-muted">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {count != null ? <Badge tone="neutral">{count}</Badge> : null}
          <ChevronDown
            className={cn(
              "size-4 text-ink-muted transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>
      {open ? (
        <div className="border-t border-border/60 px-3 py-3">{children}</div>
      ) : null}
    </div>
  );
}

function DropStageFilterBar({
  rows,
  value,
  onChange,
}: {
  rows: PipelineJourneyRow[];
  value: DropStageFilter;
  onChange: (filter: DropStageFilter) => void;
}) {
  const filters = useMemo(() => availableDropStageFilters(rows), [rows]);
  if (filters.length <= 1) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {filters.map((filter) => {
        const count = countJourneyRowsForDropFilter(rows, filter);
        const active = value === filter;
        return (
          <button
            key={filter}
            type="button"
            onClick={() => onChange(filter)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "border-ink/20 bg-ink text-surface"
                : "border-border/70 bg-surface text-ink-muted hover:border-border hover:text-ink",
            )}
          >
            <span>{dropStageFilterLabel(filter)}</span>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                active ? "bg-surface/20 text-surface" : "bg-surface-subtle text-ink-muted",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: PipelineJourneyRow["outcome"] }) {
  if (outcome === "on_rack") return <Badge tone="good">On rack</Badge>;
  if (outcome === "dropped") return <Badge tone="bad">Dropped</Badge>;
  return <Badge tone="warn">Stalled</Badge>;
}

function JourneyFunnel({ run }: { run: SearchPipelineDebugV1 }) {
  const s = run.journeySummary;
  if (!s) return null;
  const steps = [
    { label: "Catalog fetch", count: s.catalogFetched },
    { label: "After pool filters", count: s.afterPoolFilters },
    { label: "Pre-verify", count: s.preVerify },
    { label: "Verified", count: s.verified },
    { label: "On rack", count: s.onRack },
  ];
  return (
    <div className="mb-4 rounded-xl border border-border/70 bg-surface px-4 py-3">
      <p className="text-[13px] font-semibold text-ink">Pipeline funnel</p>
      <div className="mt-3 flex flex-wrap items-center gap-1 text-[12px] text-ink-muted">
        {steps.map((step, i) => (
          <span key={step.label} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-ink-muted/60">→</span> : null}
            <span className="font-medium text-ink">{step.count}</span>
            <span>{step.label}</span>
          </span>
        ))}
      </div>
      {(s.dropped > 0 || s.stalled > 0) && s.byDropStage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {s.dropped > 0 ? (
            <Badge tone="bad">{s.dropped} dropped</Badge>
          ) : null}
          {s.stalled > 0 ? (
            <Badge tone="warn">{s.stalled} stalled</Badge>
          ) : null}
          {Object.entries(s.byDropStage).map(([stage, count]) => (
            <Badge key={stage} tone="neutral">
              {dropStageLabel(stage as Parameters<typeof dropStageLabel>[0])}: {count}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function JourneyListItem({
  row,
  catalogById,
  getProductById,
  showDropDetail = false,
}: {
  row: PipelineJourneyRow;
  catalogById: Record<string, Record<string, unknown>>;
  getProductById?: Record<string, Record<string, unknown>>;
  showDropDetail?: boolean;
}) {
  return (
    <ProductDebugCard
      product={row.product}
      catalogById={catalogById}
      getProductById={getProductById}
      badges={
        <>
          <OutcomeBadge outcome={row.outcome} />
          {row.slot ? (
            <Badge tone="violet">{SLOT_LABEL[row.slot] ?? row.slot}</Badge>
          ) : null}
          {row.dropStage ? (
            <Badge tone="bad">{dropStageLabel(row.dropStage)}</Badge>
          ) : null}
        </>
      }
      metaLines={[
        `Furthest stage: ${row.furthestStage}`,
        row.score != null ? `Score: ${row.score.toFixed(2)}` : "",
      ].filter(Boolean)}
      reason={
        showDropDetail && (row.dropReason || row.outcome !== "on_rack")
          ? row.dropReason ??
            (row.outcome === "on_rack"
              ? `Shown in ${SLOT_LABEL[row.slot ?? ""] ?? row.slot ?? "rack"} slot`
              : undefined)
          : row.outcome === "on_rack"
            ? `Shown in ${SLOT_LABEL[row.slot ?? ""] ?? row.slot ?? "rack"} slot`
            : row.dropReason
      }
      reasonLabel={
        row.outcome === "dropped" || row.outcome === "stalled"
          ? "Why removed / stalled"
          : "Status"
      }
      reasonTone={
        row.outcome === "dropped"
          ? "drop"
          : row.outcome === "stalled"
            ? "default"
            : "slot"
      }
    />
  );
}

function FallbackBanner({
  fallbacks,
  method,
  tierJudgeFailureReason,
}: Pick<
  SearchPipelineDebugV1,
  "fallbacks" | "method" | "tierJudgeFailureReason"
>) {
  if (!fallbacks.length && method === "tier_judge" && !tierJudgeFailureReason) {
    return null;
  }
  return (
    <div className="mb-4 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <p className="text-[13px] font-semibold text-amber-950 dark:text-amber-50">
        Slotting: {method.replace(/_/g, " ")}
        {tierJudgeFailureReason
          ? ` · judge fallback (${tierJudgeFailureReason.replace(/_/g, " ")})`
          : null}
      </p>
      {fallbacks.map((f, i) => (
        <p key={`${f.path}-${i}`} className="text-[12px] leading-relaxed text-amber-950/90 dark:text-amber-50/95">
          <span className="font-semibold capitalize">{f.path.replace(/_/g, " ")}</span>
          {" — "}
          {f.reason}
        </p>
      ))}
    </div>
  );
}

function SlotCard({
  row,
  catalogById,
}: {
  row: PipelineSlotRow;
  catalogById: Record<string, Record<string, unknown>>;
}) {
  const slotName = SLOT_LABEL[row.slot] ?? String(row.slot).replace(/_/g, " ");
  return (
    <ProductDebugCard
      product={row.product}
      catalogById={catalogById}
      badges={
        <>
          <Badge tone="violet">{slotName}</Badge>
          {row.verdict ? (
            <Badge tone={row.verdict === "buy" ? "good" : "warn"}>{row.verdict}</Badge>
          ) : null}
          {row.tier != null ? <Badge tone="neutral">tier {row.tier}</Badge> : null}
        </>
      }
      metaLines={[
        `Assignment path: ${row.source.replace(/_/g, " ")}`,
        row.confidence ? `Confidence: ${row.confidence}` : "",
      ].filter(Boolean)}
      reason={row.whyHere ?? row.reason}
      reasonLabel="Why this slot"
      reasonTone="slot"
    />
  );
}

function HeadToHeadCard({
  row,
  catalogById,
}: {
  row: PipelineHeadToHeadRow;
  catalogById: Record<string, Record<string, unknown>>;
}) {
  return (
    <li className="space-y-2 rounded-lg border border-border/70 bg-surface p-3">
      <ReasonBlock label="Comparison result" text={row.tradeoff} tone="default" />
      <ul className="space-y-2">
        {row.products.map((p) => (
          <ProductDebugCard
            key={p.id}
            product={p}
            catalogById={catalogById}
            badges={
              p.id === row.winner.id ? (
                <Badge tone="good">Winner</Badge>
              ) : (
                <Badge tone="neutral">Compared</Badge>
              )
            }
          />
        ))}
      </ul>
    </li>
  );
}

export const SearchPipelinePanel = memo(function SearchPipelinePanel({
  run,
}: {
  run: SearchPipelineDebugV1;
}) {
  const catalogById = run.catalogById ?? {};
  const getProductById = run.getProductById ?? {};
  const journey = run.journey ?? [];
  const onScreen = run.onScreen ?? run.slots.map((s) => s.product);
  const [dropFilter, setDropFilter] = useState<DropStageFilter>("all");

  const removableRows = useMemo(
    () => journey.filter((row) => row.outcome === "dropped" || row.outcome === "stalled"),
    [journey],
  );
  const filteredRemovable = useMemo(
    () => removableRows.filter((row) => journeyRowMatchesDropFilter(row, dropFilter)),
    [removableRows, dropFilter],
  );
  const filteredJourney = useMemo(
    () =>
      dropFilter === "all"
        ? journey
        : journey.filter((row) => journeyRowMatchesDropFilter(row, dropFilter)),
    [journey, dropFilter],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-surface-subtle/20 p-4">
      <div className="mb-4 rounded-xl border border-border/70 bg-surface px-4 py-3">
        <p className="text-[15px] font-semibold leading-snug text-ink">{run.query}</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          {new Date(run.ts).toLocaleTimeString()} ·{" "}
          {run.journeySummary?.catalogFetched ?? run.catalogFetched?.length ?? run.fetched.length}{" "}
          catalog · {run.verified.length} verified · {run.slots.length} on rack
        </p>
        {run.briefBudget ? (
          <p className="mt-1.5 text-[12px] font-medium text-ink-muted">
            Search budget: {run.briefBudget.label}
          </p>
        ) : null}
      </div>

      <FallbackBanner
        fallbacks={run.fallbacks}
        method={run.method}
        tierJudgeFailureReason={run.tierJudgeFailureReason}
      />

      <JourneyFunnel run={run} />

      <div className="flex flex-col gap-3">
        <Section
          title="On screen"
          subtitle="Final rack — matches curated picks shown in chat."
          count={onScreen.length}
          defaultOpen
        >
          <ul className="space-y-2">
            {run.slots.length
              ? run.slots.map((row, i) => (
                  <SlotCard key={`${row.product.id}-${row.slot}-${i}`} row={row} catalogById={catalogById} />
                ))
              : onScreen.map((p) => (
                  <ProductDebugCard
                    key={p.id}
                    product={p}
                    catalogById={catalogById}
                    badges={<Badge tone="good">On rack</Badge>}
                  />
                ))}
          </ul>
        </Section>

        <Section
          title="Removed / stalled"
          subtitle="Products that did not reach the rack. Filter by drop reason below."
          count={filteredRemovable.length}
          defaultOpen
        >
          <DropStageFilterBar
            rows={removableRows}
            value={dropFilter}
            onChange={setDropFilter}
          />
          {filteredRemovable.length ? (
            <ul className="space-y-2">
              {filteredRemovable.map((row) => (
                <JourneyListItem
                  key={row.product.id}
                  row={row}
                  catalogById={catalogById}
                  getProductById={getProductById}
                  showDropDetail
                />
              ))}
            </ul>
          ) : removableRows.length ? (
            <p className="text-[13px] text-ink-muted">
              No products match the selected filter.
            </p>
          ) : (
            <p className="text-[13px] text-ink-muted">
              No products were removed or stalled this run.
            </p>
          )}
        </Section>

        <Section
          title="Full product journey"
          subtitle="Every product from first catalog fetch through verify and slotting."
          count={filteredJourney.length}
        >
          {dropFilter !== "all" ? (
            <p className="mb-3 text-[12px] text-ink-muted">
              Filter active: {dropStageFilterLabel(dropFilter)} ({filteredJourney.length}{" "}
              of {journey.length})
            </p>
          ) : null}
          <ul className="space-y-2">
            {filteredJourney.map((row) => (
              <JourneyListItem
                key={row.product.id}
                row={row}
                catalogById={catalogById}
                getProductById={getProductById}
                showDropDetail={row.outcome !== "on_rack"}
              />
            ))}
          </ul>
        </Section>

        <Section
          title="1 · Catalog fetch (raw)"
          subtitle="Every unique product returned by portfolio searches before pool filters."
          count={run.catalogFetched?.length ?? run.fetched.length}
        >
          <ul className="space-y-2">
            {(run.catalogFetched ?? run.fetched).map((p) => (
              <ProductDebugCard
                key={p.id}
                product={p}
                catalogById={catalogById}
                getProductById={getProductById}
              />
            ))}
          </ul>
        </Section>

        <Section
          title="Pool filter drops"
          subtitle="Removed before scoring — avoid terms, shipping guard, gift merch, near-duplicates."
          count={run.poolFilterDrops?.length ?? 0}
        >
          <ul className="space-y-2">
            {(run.poolFilterDrops ?? []).map((d, i) => (
              <ProductDebugCard
                key={`${d.product.id}-${d.stage}-${i}`}
                product={d.product}
                catalogById={catalogById}
                badges={<Badge tone="bad">{dropStageLabel(d.stage as Parameters<typeof dropStageLabel>[0])}</Badge>}
                reason={d.reason}
                reasonLabel="Drop reason"
                reasonTone="drop"
              />
            ))}
          </ul>
        </Section>

        <Section
          title="2 · After pool filters"
          subtitle="Candidates entering score + constraint gate."
          count={run.fetched.length}
        >
          <ul className="space-y-2">
            {run.fetched.map((p) => (
              <ProductDebugCard
                key={p.id}
                product={p}
                catalogById={catalogById}
                getProductById={getProductById}
              />
            ))}
          </ul>
        </Section>

        {(run.scoringConstraintDrops?.length ?? 0) > 0 ? (
          <Section
            title="Scoring constraint drops"
            subtitle="Color, gender, or must-have violations before verify."
            count={run.scoringConstraintDrops!.length}
          >
            <ul className="space-y-2">
              {run.scoringConstraintDrops!.map((d, i) => (
                <ProductDebugCard
                  key={`${d.product.id}-${i}`}
                  product={d.product}
                  catalogById={catalogById}
                  badges={<Badge tone="bad">{dropStageLabel(d.stage as Parameters<typeof dropStageLabel>[0])}</Badge>}
                  reason={d.reason}
                  reasonLabel="Drop reason"
                  reasonTone="drop"
                />
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          title="3 · Pre-verify ranking"
          subtitle="Scored candidates considered for live stock verification."
          count={run.preVerify.length}
        >
          <ul className="space-y-2">
            {(run.preVerify as PipelinePreVerifyProduct[]).map((p) => (
              <ProductDebugCard
                key={p.id}
                product={p}
                catalogById={catalogById}
                getProductById={getProductById}
                score={p.score}
                scoreBreakdown={p.scoreBreakdown}
                metaLines={formatSizeResolutionLines(p.sizeResolution)}
              />
            ))}
          </ul>
        </Section>

        <Section
          title="4 · Verified (in stock)"
          subtitle="Passed get_product — purchasable with native checkout."
          count={run.verified.length}
          defaultOpen
        >
          <ul className="space-y-2">
            {run.verified.map((p) => (
              <ProductDebugCard
                key={p.id}
                product={p}
                catalogById={catalogById}
                getProductById={getProductById}
                badges={<Badge tone="good">Verified</Badge>}
                verifySnapshot={p.verifySnapshot}
                metaLines={formatSizeResolutionLines(p.sizeResolution)}
                reason="Survived availability verification and shipping guard."
                reasonLabel="Status"
              />
            ))}
          </ul>
        </Section>

        {run.verifyNotAttempted?.length ? (
          <Section
            title="Verify skipped (budget)"
            subtitle={`Ranked for verify but never attempted live check${run.verifyAttempted != null ? ` (${run.verifyAttempted} attempted)` : ""}.`}
            count={run.verifyNotAttempted.length}
          >
            <ul className="space-y-2">
              {run.verifyNotAttempted.map((p) => (
                <ProductDebugCard
                  key={p.id}
                  product={p}
                  catalogById={catalogById}
                  getProductById={getProductById}
                  score={p.score}
                  scoreBreakdown={p.scoreBreakdown}
                  metaLines={formatSizeResolutionLines(p.sizeResolution)}
                  reason="Below verify attempt cap or enough picks verified first."
                  reasonLabel="Status"
                />
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          title="Verify drops"
          subtitle="Failed before slotting — with the exact gate that removed them."
          count={run.verifyDrops.length}
        >
          <ul className="space-y-2">
            {run.verifyDrops.map((d, i) => (
              <ProductDebugCard
                key={`${d.product.id}-${d.stage}-${i}`}
                product={d.product}
                catalogById={catalogById}
                getProductById={getProductById}
                badges={<Badge tone="bad">Dropped</Badge>}
                verifySnapshot={d.verifySnapshot}
                metaLines={[
                  `Stage: ${d.stage.replace(/_/g, " ")}`,
                  ...formatSizeResolutionLines(d.sizeResolution),
                ]}
                reason={d.reason}
                reasonLabel="Drop reason"
                reasonTone="drop"
              />
            ))}
          </ul>
        </Section>

        {(run.slottingDrops?.length ?? 0) > 0 ? (
          <Section
            title="Slotting drops"
            subtitle="Listing hygiene, judge omissions, and post-judge constraint violations."
            count={run.slottingDrops!.length}
          >
            <ul className="space-y-2">
              {run.slottingDrops!.map((d, i) => (
                <ProductDebugCard
                  key={`${d.product.id}-${d.stage}-${i}`}
                  product={d.product}
                  catalogById={catalogById}
                  badges={<Badge tone="bad">{dropStageLabel(d.stage as Parameters<typeof dropStageLabel>[0])}</Badge>}
                  reason={d.reason}
                  reasonLabel="Drop reason"
                  reasonTone="drop"
                />
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          title="5 · Listing hygiene"
          subtitle="Regex/junk tells — junk listings are removed before the judge."
          count={run.listingHygiene.length}
        >
          <ul className="space-y-2">
            {run.listingHygiene.map((row: PipelineListingHygieneRow) => (
              <ProductDebugCard
                key={row.product.id}
                product={row.product}
                catalogById={catalogById}
                badges={
                  row.dropped ? (
                    <Badge tone="bad">Junk — dropped</Badge>
                  ) : row.quality === "suspect" ? (
                    <Badge tone="warn">Suspect</Badge>
                  ) : (
                    <Badge tone="good">Clean</Badge>
                  )
                }
                metaLines={[
                  `Quality: ${row.quality}`,
                  row.flags.length ? `Flags: ${row.flags.join(", ")}` : "",
                ].filter(Boolean)}
                reason={
                  row.dropReason ??
                  (row.notes.length > 0 ? row.notes.join(" · ") : undefined)
                }
                reasonLabel={row.dropped ? "Drop reason" : "Hygiene notes"}
                reasonTone={row.dropped ? "drop" : "default"}
              />
            ))}
          </ul>
        </Section>

        <Section
          title="6 · Finalists"
          subtitle="Advanced from triage into head-to-head compare."
          count={run.finalists.length}
          defaultOpen
        >
          <ul className="space-y-2">
            {run.finalists.map((p) => (
              <ProductDebugCard
                key={p.id}
                product={p}
                catalogById={catalogById}
                badges={<Badge tone="good">Finalist</Badge>}
              />
            ))}
          </ul>
        </Section>

        <Section
          title="7 · Triage verdicts"
          subtitle="Wide judge pass — advance or drop before deep compare."
          count={run.triage.length}
          defaultOpen
        >
          <ul className="space-y-2">
            {run.triage.map((row: PipelineTriageRow) => (
              <ProductDebugCard
                key={`${row.product.id}-${row.verdict}`}
                product={row.product}
                catalogById={catalogById}
                badges={
                  <Badge tone={row.verdict === "advance" ? "good" : "bad"}>
                    {row.verdict}
                  </Badge>
                }
                reason={row.note}
                reasonLabel="Triage note"
              />
            ))}
          </ul>
        </Section>

        <Section
          title="8 · Head-to-head"
          subtitle="Pairwise comparisons among finalists."
          count={run.headToHead.length}
        >
          <ul className="space-y-3">
            {run.headToHead.map((row, i) => (
              <HeadToHeadCard key={`h2h-${i}`} row={row} catalogById={catalogById} />
            ))}
          </ul>
        </Section>

        <Section
          title="9 · Final rack slots"
          subtitle="Exactly why each product landed in hero, value, popular, gem, or gallery."
          count={run.slots.length}
          defaultOpen
        >
          <ul className="space-y-2">
            {run.slots.map((row, i) => (
              <SlotCard key={`${row.product.id}-${row.slot}-${i}`} row={row} catalogById={catalogById} />
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
});
