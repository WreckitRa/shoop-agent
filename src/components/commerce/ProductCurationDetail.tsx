"use client";

import { Check, Loader2 } from "lucide-react";
import { formatRetailerCheckDisplay } from "@/lib/commerce/pick-insight";
import type { ProductCuration } from "@/components/commerce/use-product-curation";
import { cn } from "@/lib/ai-chat/cn";

/**
 * Shown while the heuristic pick is on screen but the Opus curator is still
 * refining the deep insight. Signals that the content will sharpen shortly.
 */
function PersonalizingChip() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-brand ring-1 ring-brand/20"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3 animate-spin" aria-hidden />
      Personalizing…
    </span>
  );
}

// ── Skeleton helpers ───────────────────────────────────────────────────────
function PulseBar({ w, h = "h-3" }: { w: string; h?: string }) {
  return (
    <div
      className={cn(
        "rounded bg-slate-200/80 animate-pulse motion-reduce:animate-none",
        h,
        w,
      )}
    />
  );
}

/**
 * Skeleton that matches `ProductCurationSidebarPanels` exactly — same box
 * dimensions and layout so there is zero layout-shift when curation resolves.
 */
export function ProductCurationSidebarSkeleton() {
  return (
    <>
      {/* "3 reasons this fits you" block */}
      <div className="rounded-xl bg-slate-100 p-3">
        <PulseBar w="w-36" h="h-2.5" />
        <ul className="mt-2 flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-start gap-2.5">
              <div className="mt-0.5 size-3 shrink-0 rounded-full bg-slate-300/70 animate-pulse motion-reduce:animate-none" />
              <PulseBar w={i === 1 ? "w-full" : i === 2 ? "w-[88%]" : "w-[76%]"} />
            </li>
          ))}
        </ul>
      </div>

      {/* Verdict block */}
      <div className="rounded-[10px] bg-slate-50/80 px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <PulseBar w="w-20" />
          <PulseBar w="w-16" />
        </div>
        <div className="mt-2 flex items-start gap-2">
          <div className="mt-0.5 size-4 shrink-0 rounded-full bg-slate-200/80 animate-pulse motion-reduce:animate-none" />
          <div className="flex-1 space-y-1.5">
            <PulseBar w="w-full" />
            <PulseBar w="w-[85%]" />
          </div>
        </div>
        <PulseBar w="w-28" h="h-2.5" />
      </div>
    </>
  );
}

/**
 * Skeleton that matches `ProductCurationInsightRow` exactly — same two-column
 * layout with a "How I Picked" story column and a "What I Checked" list.
 */
export function ProductCurationInsightRowSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mt-6 flex flex-col gap-10 pb-10 lg:flex-row"
    >
      {/* Left — story column */}
      <div className="min-w-0 flex-[2] space-y-3">
        <PulseBar w="w-40" h="h-4" />
        <div className="space-y-2">
          <PulseBar w="w-full" />
          <PulseBar w="w-[96%]" />
          <PulseBar w="w-full" />
          <PulseBar w="w-[88%]" />
        </div>

        {/* "What would change my mind" box */}
        <div className="mt-4 space-y-2.5 rounded-[10px] bg-slate-50 px-[18px] py-4">
          <PulseBar w="w-44" h="h-2.5" />
          <div className="space-y-2 pl-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="size-1.5 shrink-0 rounded-full bg-slate-300/70 animate-pulse motion-reduce:animate-none" />
                <PulseBar
                  w={i === 0 ? "w-[78%]" : i === 1 ? "w-full" : "w-[65%]"}
                  h="h-2.5"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — checked column */}
      <div className="min-w-0 flex-1 space-y-3">
        <PulseBar w="w-28" h="h-4" />
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="mt-0.5 size-3.5 shrink-0 rounded-full bg-slate-300/70 animate-pulse motion-reduce:animate-none" />
              <PulseBar
                w={[
                  "w-[80%]",
                  "w-full",
                  "w-[72%]",
                  "w-[90%]",
                ][i] ?? "w-full"}
                h="h-2.5"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Lovable PDP reference colors */
const PICKED_HEADING = "#1a1a2e";
const PICKED_BODY = "#444444";
const PICKED_CHANGE_BG = "#f8fafc";
const PICKED_CHECK_TEXT = "#555555";
const PICKED_CHECK_STROKE = "#10B981";

const VERDICT_HEADLINE: Record<
  ProductCuration["verdict"],
  { label: string; className: string; boxClass: string }
> = {
  buy: {
    label: "STRONG BUY",
    className: "text-[#047857]",
    boxClass: "bg-emerald-900/10",
  },
  wait: {
    label: "WAIT",
    className: "text-amber-700",
    boxClass: "bg-amber-50/80",
  },
  dont_recommend: {
    label: "PASS",
    className: "text-rose-700",
    boxClass: "bg-rose-50/80",
  },
};

/** Two-column “How I picked” / “What I checked” row (Lovable layout). */
export function ProductCurationInsightRow({
  curation,
  personalizing = false,
}: {
  curation: ProductCuration;
  personalizing?: boolean;
}) {
  return (
    <div
      id="how-i-picked"
      className="mt-6 flex flex-col gap-10 pb-10 lg:flex-row"
    >
      <div className="min-w-0 flex-[2]">
        <ProductCurationStoryColumn
          curation={curation}
          personalizing={personalizing}
        />
      </div>
      <div className="min-w-0 flex-1">
        <ProductCurationCheckedColumn curation={curation} />
      </div>
    </div>
  );
}

/** Left column: how picked + change-my-mind card. */
export function ProductCurationStoryColumn({
  curation,
  personalizing = false,
}: {
  curation: ProductCuration;
  personalizing?: boolean;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2
          className="text-base font-extrabold uppercase tracking-[0.04em]"
          style={{ color: PICKED_HEADING }}
        >
          How I Picked This
        </h2>
        {personalizing ? <PersonalizingChip /> : null}
      </div>
      <p
        className="m-0 text-[15px] leading-[1.65]"
        style={{ color: PICKED_BODY }}
      >
        {curation.insight.pickStory}
      </p>

      <div
        className="mt-4 rounded-[10px] border-none px-[18px] py-4"
        style={{ backgroundColor: PICKED_CHANGE_BG }}
      >
        <div
          className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]"
          style={{ color: PICKED_HEADING }}
        >
          What would change my mind
        </div>
        <ul
          className="m-0 list-disc pl-[18px] text-[13px] leading-[1.6]"
          style={{ color: PICKED_HEADING }}
        >
          {curation.insight.changeMindItems.map((item, i) => (
            <li
              key={item}
              className={cn(
                i < curation.insight.changeMindItems.length - 1 && "mb-1",
              )}
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Right column: what I checked. */
export function ProductCurationCheckedColumn({
  curation,
}: {
  curation: ProductCuration;
}) {
  return (
    <section>
      <h3
        className="mb-3 text-[13px] font-bold uppercase tracking-[0.04em]"
        style={{ color: PICKED_HEADING }}
      >
        What I Checked
      </h3>
      <div className="flex flex-col gap-2">
        {curation.insight.checkedItems.map((item) => (
          <div key={item} className="flex items-start gap-2.5">
            <Check
              className="mt-0.5 size-3.5 shrink-0"
              style={{ color: PICKED_CHECK_STROKE }}
              strokeWidth={2.5}
              aria-hidden
            />
            <span
              className="text-[13px] leading-[1.4]"
              style={{ color: PICKED_CHECK_TEXT }}
            >
              {item}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Sidebar blocks: fit reasons + verdict (desktop). */
export function ProductCurationSidebarPanels({
  curation,
  personalizing = false,
}: {
  curation: ProductCuration;
  personalizing?: boolean;
}) {
  const verdict = VERDICT_HEADLINE[curation.verdict];
  const priceCheck = formatRetailerCheckDisplay(
    curation.insight.retailerCheckNote,
    curation.updatedAt,
  );

  return (
    <>
      <div className="rounded-xl bg-slate-100 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
            3 reasons this fits you
          </p>
          {personalizing ? <PersonalizingChip /> : null}
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {curation.insight.fitReasons.map((line) => (
            <li
              key={line}
              className="flex gap-2.5 text-xs leading-snug text-[#333]"
            >
              <Check
                className="mt-0.5 size-3 shrink-0 text-emerald-600"
                strokeWidth={2.5}
                aria-hidden
              />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className={cn("rounded-[10px] px-4 py-3.5", verdict.boxClass)}>
        <p className="text-sm">
          <span className="text-ink">Shoop says: </span>
          <span className={cn("font-bold uppercase", verdict.className)}>
            {verdict.label}
          </span>
        </p>
        <p className="mt-2 flex gap-2 text-sm leading-snug text-ink">
          <Check className="mt-0.5 size-4 shrink-0 text-[#047857]" aria-hidden />
          <span>
            <span className="font-bold">{curation.reason}</span>
          </span>
        </p>
        <p className="mt-2 text-xs text-ink-secondary">{priceCheck}</p>
      </div>
    </>
  );
}
