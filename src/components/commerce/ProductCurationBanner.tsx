"use client";

import { AlertOctagon, Check, Clock, Sparkles } from "lucide-react";
import type { CurationSlot, CurationVerdict } from "@/lib/ai-chat/types";
import { useProductCuration } from "@/components/commerce/use-product-curation";

/** Skeleton that matches the shape of `ProductCurationBanner`. */
export function CurationBannerSkeleton() {
  return (
    <section
      aria-busy="true"
      className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3"
    >
      {/* Two badge pills */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-5 w-20 animate-pulse rounded-full bg-slate-200/80 motion-reduce:animate-none" />
        <div className="h-5 w-14 animate-pulse rounded-full bg-slate-200/60 motion-reduce:animate-none" />
      </div>
      {/* Reason lines */}
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-slate-200/80 motion-reduce:animate-none" />
        <div className="h-3 w-[88%] animate-pulse rounded bg-slate-200/60 motion-reduce:animate-none" />
      </div>
      {/* Description line */}
      <div className="h-2.5 w-48 animate-pulse rounded bg-slate-200/50 motion-reduce:animate-none" />
    </section>
  );
}

const SLOT_LABEL: Record<CurationSlot, string> = {
  shoop_pick: "Shoop's pick",
  best_value: "Best value",
  most_popular: "Most popular",
  gem: "Hidden gem",
  gallery: "Also consider",
  loosened: "Relaxed match",
  reframed: "Broader match",
};

const VERDICT: Record<
  CurationVerdict,
  {
    label: string;
    description: string;
    icon: typeof Sparkles;
    badgeClass: string;
    cardClass: string;
  }
> = {
  buy: {
    label: "Buy",
    description: "Shoop recommends buying this now.",
    icon: Check,
    badgeClass: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    cardClass: "border-emerald-200 bg-emerald-50/40",
  },
  wait: {
    label: "Wait",
    description: "Solid item — Shoop suggests holding before you buy.",
    icon: Clock,
    badgeClass: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    cardClass: "border-amber-200 bg-amber-50/50",
  },
  dont_recommend: {
    label: "Don't buy",
    description: "Shoop advises against this for you.",
    icon: AlertOctagon,
    badgeClass: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    cardClass: "border-rose-200 bg-rose-50/50",
  },
};

/**
 * Fallback card when PDP has no persisted curation (e.g. direct link).
 */
export function ProductCurationBanner({ productId }: { productId: string }) {
  const { curation, phase } = useProductCuration(productId);

  if (phase === "loading") {
    return <CurationBannerSkeleton />;
  }

  if (phase !== "ready" || !curation) return null;

  const verdict = VERDICT[curation.verdict];
  const VerdictIcon = verdict.icon;

  return (
    <section
      className={`flex flex-col gap-2 rounded-2xl border px-4 py-3 ${verdict.cardClass}`}
      aria-label="Shoop curation insight"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand ring-1 ring-brand/20">
          <Sparkles className="size-3" />
          {SLOT_LABEL[curation.slot]}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${verdict.badgeClass}`}
        >
          <VerdictIcon className="size-3" />
          {verdict.label}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-ink">{curation.reason}</p>
      <p className="text-[11px] text-ink-muted">{verdict.description}</p>
    </section>
  );
}
