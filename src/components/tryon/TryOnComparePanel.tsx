"use client";

import type { RenderPickBadge } from "@/lib/fashion-memory/types/render-contract";
import type { TryonCompareVariant } from "@/lib/tryon/types";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import { cn } from "@/lib/ai-chat/cn";
import { Loader2 } from "lucide-react";

export type TryonLegendItem = {
  ref: string;
  title: string;
  price?: { amount: number; currency: string };
};

type TryOnComparePanelProps = {
  variants: TryonCompareVariant[];
  items: TryonLegendItem[];
  badgesByRef?: Record<string, RenderPickBadge[]>;
  onOpenProduct: (ref: string) => void;
  onFeedback?: (jobId: string, rating: 1 | -1) => void;
};

function formatPrice(price: { amount: number; currency: string }) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency,
  }).format(price.amount / 100);
}

function formatMs(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TryOnComparePanel({
  variants,
  items,
  badgesByRef,
  onOpenProduct,
  onFeedback,
}: TryOnComparePanelProps) {
  const sorted = [...variants].sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));

  return (
    <div className="mt-3 space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Provider compare
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((variant) => (
          <div
            key={variant.job_id}
            className={cn(
              "rounded-xl border p-2",
              variant.status === "completed" && "border-emerald-500/30",
              variant.status === "failed" && "border-red-500/20",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">{variant.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatMs(variant.ms)}
              </span>
            </div>
            {variant.status === "processing" || variant.status === "pending" ? (
              <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Dressing…
              </div>
            ) : variant.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={variant.image_url}
                alt={`${variant.label} try-on`}
                className="aspect-[3/4] w-full rounded-lg object-cover"
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {variant.error ?? "Couldn't dress this one."}
              </p>
            )}
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {variant.provider}
            </p>
            {variant.image_url && onFeedback ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => onFeedback(variant.job_id, 1)}
                  aria-label={`${variant.label} helpful`}
                >
                  👍
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => onFeedback(variant.job_id, -1)}
                  aria-label={`${variant.label} unhelpful`}
                >
                  👎
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.ref}>
            <button
              type="button"
              className="w-full rounded border p-2 text-left text-sm hover:bg-muted/50"
              onClick={() => onOpenProduct(item.ref)}
            >
              <div className="font-medium">{item.title}</div>
              {item.price ? (
                <div className="text-xs text-muted-foreground">
                  {formatPrice(item.price)}
                </div>
              ) : null}
              {badgesByRef?.[item.ref]?.map((b, i) => (
                <span key={i} className="mr-1 text-[10px] text-muted-foreground">
                  {b.kind === "size_converted"
                    ? `Size ${b.merchant_label}`
                    : b.kind}
                </span>
              ))}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">{TRYON_DISCLAIMER}</p>
    </div>
  );
}
