"use client";

import type { RenderPickBadge } from "@/lib/fashion-memory/types/render-contract";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";

export type TryonLegendItem = {
  ref: string;
  title: string;
  price?: { amount: number; currency: string };
};

type TryOnLegendPanelProps = {
  imageUrl: string;
  items: TryonLegendItem[];
  badgesByRef?: Record<string, RenderPickBadge[]>;
  onOpenProduct: (ref: string) => void;
  onFeedback?: (rating: 1 | -1) => void;
};

function formatPrice(price: { amount: number; currency: string }) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency,
  }).format(price.amount / 100);
}

/** Legend panel — no arrow overlays in MVP. */
export function TryOnLegendPanel({
  imageUrl,
  items,
  badgesByRef,
  onOpenProduct,
  onFeedback,
}: TryOnLegendPanelProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="AI try-on visualization"
          className="w-full rounded-lg object-cover"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">{TRYON_DISCLAIMER}</p>
        {onFeedback ? (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={() => onFeedback(1)}
              aria-label="Helpful try-on"
            >
              👍
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={() => onFeedback(-1)}
              aria-label="Unhelpful try-on"
            >
              👎
            </button>
          </div>
        ) : null}
      </div>
      <ul className="w-full shrink-0 space-y-2 sm:w-48">
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
    </div>
  );
}
