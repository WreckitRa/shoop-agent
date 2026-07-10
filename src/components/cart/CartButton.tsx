"use client";

import { Loader2, ShoppingBag } from "lucide-react";
import { cartItemCount, useCartStore } from "@/components/cart/cart-store";
import { cn } from "@/lib/ai-chat/cn";

export function CartButton({ className }: { className?: string }) {
  const cart = useCartStore((s) => s.cart);
  const loading = useCartStore((s) => s.loading);
  const mutating = useCartStore((s) => s.mutating);
  const drawerOpen = useCartStore((s) => s.drawerOpen);
  const setDrawerOpen = useCartStore((s) => s.setDrawerOpen);
  const count = cartItemCount(cart);

  return (
    <button
      type="button"
      data-cart-trigger
      onClick={() => setDrawerOpen(!drawerOpen)}
      className={cn(
        "relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition hover:bg-surface-tint hover:text-ink",
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
    </button>
  );
}
