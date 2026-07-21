"use client";

import { useEffect, useState } from "react";
import { Loader2, ShoppingBag } from "lucide-react";
import { cartItemCount, useCartStore } from "@/components/cart/cart-store";
import { cn } from "@/lib/ai-chat/cn";
import type { ActiveCartLine, ActiveCartState } from "@/lib/cart/types";

function itemName(title: string): string {
  const normalized = title.toLowerCase();
  const categories = [
    "blazer",
    "dress",
    "jacket",
    "coat",
    "bag",
    "shirt",
    "sweater",
    "skirt",
    "watch",
  ];
  const category = categories.find((value) => normalized.includes(value));
  if (category) return category;
  if (/\b(sneaker|shoe|boot)s?\b/.test(normalized)) return "pair";
  return "pick";
}

function biggestPriceDrop(lines: ActiveCartLine[]): {
  cents: number;
  currency: string;
} | null {
  let biggest: { cents: number; currency: string } | null = null;
  for (const line of lines) {
    if (line.priceAtAddCents == null || line.priceCents == null) continue;
    const cents = line.priceAtAddCents - line.priceCents;
    if (cents <= 0 || (biggest && cents <= biggest.cents)) continue;
    biggest = { cents, currency: line.currency ?? "USD" };
  }
  return biggest;
}

function formatDrop(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function cartNudgeCopy(cart: ActiveCartState): string {
  const firstLine = cart.lineItems[0];
  if (!firstLine) return "";
  const subject =
    cart.lineItems.length === 1
      ? `Your ${itemName(firstLine.title)}’s`
      : "Your picks are";
  const drop = biggestPriceDrop(cart.lineItems);
  return drop
    ? `${subject} still here… and ${cart.lineItems.length === 1 ? "it" : "one"} dropped ${formatDrop(drop.cents, drop.currency)}.`
    : `${subject} still here… ready when you are.`;
}

export function CartButton({ className }: { className?: string }) {
  const cart = useCartStore((s) => s.cart);
  const loading = useCartStore((s) => s.loading);
  const mutating = useCartStore((s) => s.mutating);
  const drawerOpen = useCartStore((s) => s.drawerOpen);
  const setDrawerOpen = useCartStore((s) => s.setDrawerOpen);
  const count = cartItemCount(cart);
  const [showLandingNudge, setShowLandingNudge] = useState(false);
  const cartSignature = cart?.lineItems.length
    ? cart.lineItems
        .map((line) => `${line.variantId}:${line.quantity}`)
        .sort()
        .join("|")
    : "";
  const nudgeCopy = cart ? cartNudgeCopy(cart) : "";

  useEffect(() => {
    if (!cartSignature || !nudgeCopy) return;
    const storageKey = `shoop:cart-nudge:${cartSignature}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // A restored-cart nudge can still show when storage is unavailable.
    }

    const revealTimer = window.setTimeout(
      () => setShowLandingNudge(true),
      650,
    );
    const hideTimer = window.setTimeout(
      () => setShowLandingNudge(false),
      6500,
    );
    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(hideTimer);
    };
  }, [cartSignature, nudgeCopy]);

  return (
    <button
      type="button"
      data-cart-trigger
      onClick={() => setDrawerOpen(!drawerOpen)}
      className={cn(
        "group relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition hover:bg-surface-tint hover:text-ink",
        className,
      )}
      aria-label={`${drawerOpen ? "Close" : "Open"} cart${count ? ` with ${count} item${count === 1 ? "" : "s"}` : ""}`}
    >
      {loading || mutating ? (
        <Loader2 className="size-[18px] animate-spin" strokeWidth={1.75} />
      ) : (
        <ShoppingBag className="size-[18px]" strokeWidth={1.75} />
      )}
      {count > 0 ? (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-[3px] text-[9px] font-semibold leading-none text-white">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
      {count > 0 && nudgeCopy && !drawerOpen ? (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute right-0 top-[calc(100%+0.6rem)] z-50 w-[min(17rem,calc(100vw-1rem))]",
            "rounded-2xl border border-hairline bg-white px-4 py-3 text-left shadow-card",
            "text-[13px] font-medium leading-snug text-ink",
            "origin-top-right translate-y-1 scale-95 opacity-0 transition duration-200",
            "group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100",
            showLandingNudge &&
              "translate-y-0 scale-100 opacity-100",
          )}
        >
          {nudgeCopy}
        </span>
      ) : null}
    </button>
  );
}
