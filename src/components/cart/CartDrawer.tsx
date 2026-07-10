"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/ai-chat/cn";
import {
  AlertTriangle,
  Loader2,
  Minus,
  PackageOpen,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { cartItemCount, useCartStore } from "@/components/cart/cart-store";
import { friendlyStoreName } from "@/lib/commerce/friendly-store-name";
import type { ActiveCartGroup, ActiveCartLine } from "@/lib/cart/types";

function formatPrice(amount: number, currency: string): string {
  const value = amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function linePrice(line: ActiveCartLine, fallbackCurrency: string | null): string | null {
  const currency = line.currency ?? fallbackCurrency;
  if (!currency) return null;
  const amount =
    line.lineTotalCents ??
    (line.priceCents != null ? line.priceCents * line.quantity : null);
  return amount != null ? formatPrice(amount, currency) : null;
}

function groupTotal(group: ActiveCartGroup): string | null {
  const currency = group.currency ?? group.lineItems[0]?.currency ?? "USD";
  return group.totalCents != null ? formatPrice(group.totalCents, currency) : null;
}

function groupItemCount(group: ActiveCartGroup): number {
  return group.lineItems.reduce((sum, line) => sum + line.quantity, 0);
}

function cartSubtotalCents(groups: ActiveCartGroup[]): number | null {
  let total = 0;
  for (const group of groups) {
    if (group.totalCents == null) return null;
    total += group.totalCents;
  }
  return total;
}

function cartCurrency(groups: ActiveCartGroup[]): string {
  return groups[0]?.currency ?? groups[0]?.lineItems[0]?.currency ?? "USD";
}

const PANEL_WIDTH = "min(100vw, 34rem)";

export function CartDrawer() {
  const router = useRouter();
  const cart = useCartStore((s) => s.cart);
  const open = useCartStore((s) => s.drawerOpen);
  const loading = useCartStore((s) => s.loading);
  const mutating = useCartStore((s) => s.mutating);
  const error = useCartStore((s) => s.error);
  const setDrawerOpen = useCartStore((s) => s.setDrawerOpen);
  const panelRef = useRef<HTMLElement>(null);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);

  const itemCount = cartItemCount(cart);
  const groups = cart?.groups ?? [];
  const subtotalCents = cartSubtotalCents(groups);
  const currency = cartCurrency(groups);
  const subtotal = subtotalCents != null ? formatPrice(subtotalCents, currency) : null;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-cart-trigger]")) return;
      if (
        target.closest(
          "input, textarea, select, button, a, [contenteditable], [role='button'], [role='link'], [role='textbox']",
        )
      ) {
        return;
      }
      setDrawerOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setDrawerOpen]);

  const buyNow = useCallback(
    (
      shopDomain: string | null,
      variantId: string,
      productId?: string | null,
    ) => {
      if (!shopDomain) return;
      setDrawerOpen(false);
      const params = new URLSearchParams({
        shop: shopDomain,
        variant: variantId,
      });
      if (productId?.trim()) {
        params.set("productId", productId.trim());
      }
      router.push(`/pre-checkout?${params.toString()}`);
    },
    [router, setDrawerOpen],
  );

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label="Shopping cart"
      aria-hidden={!open}
      style={{ width: open ? PANEL_WIDTH : "0px" }}
      className={cn(
        "relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-hairline bg-white shadow-[-12px_0_40px_rgba(12,12,12,0.06)] transition-[width] duration-300 ease-out",
        open ? "border-l" : "pointer-events-none border-l-0",
      )}
    >
      <div
        style={{ width: PANEL_WIDTH }}
        className={cn(
          "flex h-full min-w-0 flex-col",
          !open && "invisible",
        )}
      >
        <header className="flex items-center justify-between border-b border-hairline-soft px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">
              Your cart
            </h2>
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink-secondary">
              {itemCount}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="inline-flex size-9 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-tint hover:text-ink"
            aria-label="Close cart"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-body-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin" />
              Refreshing cart…
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-ink-muted">
              <PackageOpen className="size-10 text-ink-muted" />
              <div>
                <p className="text-sm font-medium text-ink-soft">
                  Your cart is empty
                </p>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  Add items while you shop. You can buy any product directly.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <MerchantCartCard
                  key={group.shopDomain ?? group.cartId}
                  group={group}
                  onUpdateQuantity={updateQuantity}
                  onRemove={removeItem}
                  onBuyNow={(line) =>
                    buyNow(group.shopDomain, line.variantId, line.productId)
                  }
                />
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-hairline-soft px-5 py-4 sm:px-6 sm:py-5">
          {error ? (
            <p className="mb-3 rounded-xl border border-error-border bg-error-bg px-3 py-2 text-xs text-error-deep">
              {error}
            </p>
          ) : null}
          {itemCount > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-body-sm text-ink-secondary">
                <span>Items ({itemCount})</span>
                <span className="font-semibold text-ink">
                  {subtotal ?? `${itemCount} item${itemCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-hairline pt-3 text-base font-semibold text-ink">
                <span>Subtotal</span>
                <span>{subtotal ?? "--"}</span>
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={mutating || itemCount === 0}
              onClick={() => void clearCart()}
              className="btn-secondary h-10 px-4 text-body-sm disabled:opacity-50"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-lg px-3 py-2 text-body-sm font-medium text-ink-soft transition hover:bg-surface-tint hover:text-ink"
            >
              Keep shopping
            </button>
          </div>
        </footer>
      </div>
    </aside>
  );
}

function MerchantCartCard({
  group,
  onUpdateQuantity,
  onRemove,
  onBuyNow,
}: {
  group: ActiveCartGroup;
  onUpdateQuantity: (variantId: string, quantity: number) => Promise<boolean>;
  onRemove: (variantId: string) => Promise<boolean>;
  onBuyNow: (line: ActiveCartLine) => void;
}) {
  const total = groupTotal(group);
  const count = groupItemCount(group);

  return (
    <section className="overflow-hidden rounded-[22px] border border-hairline bg-white shadow-card">
      <div className="border-b border-hairline-soft bg-surface-subtle/80 px-4 py-3 sm:px-5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
          {friendlyStoreName(group.shopDomain)}
        </h3>
      </div>

      {group.messages.length ? (
        <div className="space-y-2 px-4 pt-4 sm:px-5">
          {group.messages.map((message, index) => (
            <div
              key={`${message.code ?? "message"}-${index}`}
              className="flex items-start gap-2 rounded-xl border border-warning-tint bg-warning-tint/60 px-3 py-2 text-xs text-warning-dark"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-emphasis" />
              <span>
                {message.content ?? "Please review your cart before checkout."}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <ul className="divide-y divide-hairline-soft">
        {group.lineItems.map((line) => {
          const price = linePrice(line, group.currency);
          return (
            <li key={line.variantId} className="p-4 sm:px-5">
              <div className="grid grid-cols-[5.5rem_1fr_auto] gap-3 sm:grid-cols-[6rem_1fr_auto] sm:gap-4">
                <div className="flex size-[5.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-muted text-ink-muted sm:size-24">
                  {line.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={line.imageUrl}
                      alt={line.title}
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <ShoppingCart className="size-6" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
                    {line.sellerName ?? friendlyStoreName(group.shopDomain)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-ink">
                    {line.title}
                  </p>
                  <button
                    type="button"
                    disabled={!group.checkout.checkoutSupported}
                    onClick={() => onBuyNow(line)}
                    className="mt-3 inline-flex h-9 items-center justify-center rounded-full bg-ink px-3.5 text-xs font-semibold text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Buy now
                  </button>
                </div>
                <div className="text-right">
                  {price ? (
                    <p className="text-[15px] font-semibold text-ink">
                      {price}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 pl-[calc(5.5rem+0.75rem)] sm:pl-28">
                <div className="inline-flex items-center gap-3">
                  <div className="inline-flex items-center overflow-hidden rounded-full border border-hairline bg-white">
                    <button
                      type="button"
                      onClick={() => void onUpdateQuantity(line.variantId, line.quantity - 1)}
                      className="p-2 text-ink-soft transition hover:bg-surface-subtle hover:text-ink disabled:opacity-50"
                      aria-label={`Decrease quantity for ${line.title}`}
                    >
                      <Minus className="size-4" />
                    </button>
                    <span className="min-w-9 text-center text-body-sm font-semibold text-ink">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onUpdateQuantity(line.variantId, line.quantity + 1)}
                      className="p-2 text-ink-soft transition hover:bg-surface-subtle hover:text-ink disabled:opacity-50"
                      aria-label={`Increase quantity for ${line.title}`}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onRemove(line.variantId)}
                  className="inline-flex size-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-error-bg hover:text-error-deep disabled:opacity-50"
                  aria-label={`Remove ${line.title}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-end border-t border-hairline-soft px-4 py-3 text-body-sm sm:px-5">
        <span className="text-ink-secondary">Subtotal:</span>
        <span className="ml-1 font-semibold text-ink">
          {total ?? `${count} item${count === 1 ? "" : "s"}`}
        </span>
      </div>
    </section>
  );
}
