"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cartItemCount, useCartStore } from "@/components/cart/cart-store";
import { friendlyStoreName } from "@/lib/commerce/friendly-store-name";
import type { ActiveCartGroup, ActiveCartLine } from "@/lib/cart/types";
import { NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";

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

function linePrice(
  line: ActiveCartLine,
  fallbackCurrency: string | null,
): string | null {
  const currency = line.currency ?? fallbackCurrency;
  if (!currency) return null;
  const amount =
    line.lineTotalCents ??
    (line.priceCents != null ? line.priceCents * line.quantity : null);
  return amount != null ? formatPrice(amount, currency) : null;
}

function groupTotal(group: ActiveCartGroup): string | null {
  const currency = group.currency ?? group.lineItems[0]?.currency ?? "USD";
  return group.totalCents != null
    ? formatPrice(group.totalCents, currency)
    : null;
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

export function CartPageView() {
  const router = useRouter();
  const cart = useCartStore((s) => s.cart);
  const loading = useCartStore((s) => s.loading);
  const mutating = useCartStore((s) => s.mutating);
  const error = useCartStore((s) => s.error);
  const refresh = useCartStore((s) => s.refresh);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const setDrawerOpen = useCartStore((s) => s.setDrawerOpen);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = cart?.groups ?? [];
  const itemCount = cartItemCount(cart);
  const subtotalCents = cartSubtotalCents(groups);
  const currency = cartCurrency(groups);
  const subtotal =
    subtotalCents != null ? formatPrice(subtotalCents, currency) : null;

  const buyNow = useCallback(
    (shopDomain: string | null, variantId: string, productId?: string | null) => {
      if (!shopDomain) return;
      setDrawerOpen(false);
      const params = new URLSearchParams({
        shop: shopDomain,
        variant: variantId,
      });
      if (productId?.trim()) params.set("productId", productId.trim());
      router.push(`/pre-checkout?${params.toString()}`);
    },
    [router, setDrawerOpen],
  );

  const checkoutFirst = () => {
    const group = groups[0];
    const line = group?.lineItems[0];
    if (!group || !line) return;
    buyNow(group.shopDomain, line.variantId, line.productId);
  };

  if (loading && !cart) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Refreshing cart…
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div>
        <p className="shoop-decide__empty">Your cart is empty.</p>
        <div className="shoop-decide__empty-ctas">
          <Link
            href={NEW_CHAT_PATH}
            className="shoop-decide__mini shoop-decide__mini--solid"
          >
            Keep finding
          </Link>
          <Link href="/moodboard" className="shoop-decide__mini">
            Moodboard
          </Link>
        </div>
      </div>
    );
  }

  const storeCount = groups.length;

  return (
    <div className="shoop-decide__cartgrid">
      <div>
        <div className="shoop-decide__sechead">
          <h3>
            {storeCount === 1
              ? "One store"
              : `${storeCount} stores, one order`}
          </h3>
          <span className="shoop-decide__bar" />
        </div>

        {error ? (
          <p className="mb-3 rounded-xl border border-error-border bg-error-bg px-3 py-2 text-xs text-error-deep">
            {error}
          </p>
        ) : null}

        {groups.map((group) => {
          const store = friendlyStoreName(group.shopDomain);
          const total = groupTotal(group);
          return (
            <section
              key={group.shopDomain ?? group.cartId}
              className="shoop-decide__store"
            >
              <div className="shoop-decide__sthead">
                <div className="shoop-decide__sthead-l">
                  <h4>{store}</h4>
                  <span
                    className={
                      group.checkout.checkoutSupported
                        ? "shoop-decide__badge shoop-decide__badge--free"
                        : "shoop-decide__badge"
                    }
                  >
                    {group.checkout.checkoutSupported
                      ? "Ready to checkout"
                      : "Review needed"}
                  </span>
                </div>
                <span className="shoop-decide__stsub">{total ?? "—"}</span>
              </div>

              {group.lineItems.map((line) => {
                const price = linePrice(line, group.currency);
                return (
                  <div key={line.variantId} className="shoop-decide__line">
                    <span className="shoop-decide__th">
                      {line.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={line.imageUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                    </span>
                    <span className="shoop-decide__info">
                      <span className="shoop-decide__line-nm">{line.title}</span>
                      <span className="shoop-decide__sz">
                        Qty {line.quantity}
                      </span>
                      <div className="shoop-decide__line-act">
                        <div
                          className="shoop-decide__qty"
                          role="group"
                          aria-label="Quantity"
                        >
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            disabled={mutating}
                            onClick={() =>
                              void updateQuantity(
                                line.variantId,
                                line.quantity - 1,
                              )
                            }
                          >
                            −
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            type="button"
                            aria-label="Increase quantity"
                            disabled={mutating}
                            onClick={() =>
                              void updateQuantity(
                                line.variantId,
                                line.quantity + 1,
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          className="shoop-decide__mini shoop-decide__mini--solid"
                          disabled={!group.checkout.checkoutSupported}
                          onClick={() =>
                            buyNow(
                              group.shopDomain,
                              line.variantId,
                              line.productId,
                            )
                          }
                        >
                          Buy now
                        </button>
                        <button
                          type="button"
                          className="shoop-decide__line-rm"
                          disabled={mutating}
                          onClick={() => void removeItem(line.variantId)}
                        >
                          Remove
                        </button>
                      </div>
                    </span>
                    <span className="shoop-decide__rt">
                      {price ? <b>{price}</b> : null}
                    </span>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      <aside className="shoop-decide__summary">
        <h3>Your order</h3>
        <div className="shoop-decide__srow">
          <span>Items ({itemCount})</span>
          <span>{subtotal ?? "—"}</span>
        </div>
        <div className="shoop-decide__srow">
          <span>Shipping</span>
          <span>At checkout</span>
        </div>
        <div className="shoop-decide__srow shoop-decide__srow--total">
          <span>Total</span>
          <b>{subtotal ?? "—"}</b>
        </div>
        <button
          type="button"
          className="shoop-decide__checkout"
          disabled={!groups[0]?.lineItems[0]}
          onClick={checkoutFirst}
        >
          <i aria-hidden />
          {storeCount > 1 ? "Checkout first store" : "Pay once"}
        </button>
        <p className="shoop-decide__fine">
          {storeCount > 1
            ? "Checkout runs per store for now — start with the first, then come back for the rest."
            : "One payment. I'll place the order and track it."}
        </p>
        <button
          type="button"
          className="mt-3 w-full text-center text-[12px] text-ink-muted hover:text-ink"
          disabled={mutating || itemCount === 0}
          onClick={() => void clearCart()}
        >
          Clear cart
        </button>
      </aside>
    </div>
  );
}
