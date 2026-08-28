"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { guestFetch } from "@/lib/client/guest-fetch";
import { persistGuestFashionPurchase } from "@/lib/fashion-memory/client/guest-bridge";
import type { ProductCard } from "@/lib/ai-chat/types";
import type { RyeCheckoutIntentSnapshot } from "@/lib/rye/types";

type RyeConfig = {
  enabled: boolean;
  stripePublishableKey?: string;
};

type RyeCheckoutPanelProps = {
  intent: RyeCheckoutIntentSnapshot;
  searchId?: string | null;
  productRef?: string | null;
  productId?: string | null;
  title?: string | null;
  brand?: string | null;
  color?: string | null;
  onComplete: (orderId: string | null) => void;
  onError: (message: string, options?: { fallback?: boolean }) => void;
  onIntentUpdate: (intent: RyeCheckoutIntentSnapshot) => void;
  onUseStoreCheckout?: () => void;
};

type FashionPurchasePayload = {
  searchId: string;
  ref: string;
  product: ProductCard;
};

function applyGuestPurchase(payload: FashionPurchasePayload | null | undefined) {
  if (!payload?.searchId || !payload.ref) return;
  persistGuestFashionPurchase(payload);
}

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "16px",
      color: "#0E0E11",
      fontFamily:
        'var(--font-dm-sans), "DM Sans", system-ui, sans-serif',
      "::placeholder": { color: "#94a3b8" },
    },
    invalid: { color: "#b80d0c", iconColor: "#b80d0c" },
  },
};

function formatRyeMoney(
  money: { amountSubunits: number; currencyCode: string } | null | undefined,
): string {
  if (!money) return "--";
  const value = money.amountSubunits / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: money.currencyCode,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${money.currencyCode}`;
  }
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" && data.error.trim()
        ? data.error
        : fallback,
    );
  }
  return data;
}

function RyePaymentForm({
  intentId,
  confirming,
  setConfirming,
  searchId,
  productRef,
  productId,
  title,
  brand,
  color,
  onComplete,
  onError,
  onIntentUpdate,
}: {
  intentId: string;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  searchId?: string | null;
  productRef?: string | null;
  productId?: string | null;
  title?: string | null;
  brand?: string | null;
  color?: string | null;
  onComplete: (orderId: string | null) => void;
  onError: (message: string, options?: { fallback?: boolean }) => void;
  onIntentUpdate: (intent: RyeCheckoutIntentSnapshot) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const handlePay = useCallback(async () => {
    if (!stripe || !elements || confirming) return;
    const card = elements.getElement(CardElement);
    if (!card) {
      onError("Card form is not ready.");
      return;
    }

    setConfirming(true);
    try {
      const { token, error: tokenError } = await stripe.createToken(card);
      if (tokenError || !token?.id) {
        throw new Error(tokenError?.message ?? "Could not tokenize card.");
      }

      const data = await readJson<{
        intent: RyeCheckoutIntentSnapshot;
        error?: string;
        fallback?: string | null;
        fixable?: boolean;
        fashionPurchase?: FashionPurchasePayload | null;
      }>(
        await guestFetch(
          `/api/rye/checkout-intents/${encodeURIComponent(intentId)}/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stripeToken: token.id,
              searchId: searchId || undefined,
              ref: productRef || undefined,
              productId: productId || undefined,
              title: title || undefined,
              brand: brand || undefined,
              color: color || undefined,
            }),
          },
        ),
        "Payment could not be completed.",
      );

      onIntentUpdate(data.intent);
      if (data.intent.state === "completed") {
        applyGuestPurchase(data.fashionPurchase);
        onComplete(data.intent.orderId);
        return;
      }
      if (data.intent.state === "failed") {
        onError(data.error ?? "Payment failed.", {
          fallback: data.fallback === "shopify",
        });
        return;
      }
      onError(data.error ?? "Payment could not be completed.");
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Payment could not be completed.",
      );
    } finally {
      setConfirming(false);
    }
  }, [
    confirming,
    elements,
    intentId,
    onComplete,
    onError,
    onIntentUpdate,
    searchId,
    productRef,
    productId,
    title,
    brand,
    color,
    setConfirming,
    stripe,
  ]);

  return (
    <div className="mt-5 border-t border-hairline pt-5">
      <p className="text-sm font-medium text-ink">Payment</p>
      <div className="mt-3 rounded-xl border border-hairline px-3 py-3">
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>
      <button
        type="button"
        disabled={!stripe || confirming}
        onClick={() => void handlePay()}
        className="btn-primary mt-4 inline-flex h-11 w-full items-center justify-center gap-2 text-[13px]"
      >
        {confirming ? <Loader2 className="size-4 animate-spin" /> : null}
        Pay now
      </button>
    </div>
  );
}

export function RyeCheckoutPanel({
  intent,
  searchId,
  productRef,
  productId,
  title,
  brand,
  color,
  onComplete,
  onError,
  onIntentUpdate,
  onUseStoreCheckout,
}: RyeCheckoutPanelProps) {
  const [config, setConfig] = useState<RyeConfig | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    void guestFetch("/api/rye/config")
      .then((res) => res.json() as Promise<RyeConfig>)
      .then(setConfig)
      .catch(() => setConfig({ enabled: false }));
  }, []);

  const stripePromise = useMemo(() => {
    if (!config?.stripePublishableKey) return null;
    return loadStripe(config.stripePublishableKey);
  }, [config?.stripePublishableKey]);

  useEffect(() => {
    const activeStates = new Set([
      "retrieving_offer",
      "placing_order",
      "requires_action",
    ]);
    if (!activeStates.has(intent.state)) return;

    setPolling(true);
    const timer = window.setInterval(() => {
      void guestFetch(`/api/rye/checkout-intents/${encodeURIComponent(intent.id)}`)
        .then((res) =>
          readJson<{
            intent: RyeCheckoutIntentSnapshot;
            error?: string | null;
            fallback?: string | null;
            fashionPurchase?: FashionPurchasePayload | null;
          }>(res, "Could not refresh checkout status."),
        )
        .then((data) => {
          onIntentUpdate(data.intent);
          if (data.intent.state === "completed") {
            applyGuestPurchase(data.fashionPurchase);
            onComplete(data.intent.orderId);
          } else if (data.intent.state === "failed") {
            onError(data.error ?? "Checkout failed.", {
              fallback: data.fallback === "shopify",
            });
          }
        })
        .catch(() => undefined);
    }, 10_000);

    return () => {
      window.clearInterval(timer);
      setPolling(false);
    };
  }, [intent.id, intent.state, onComplete, onError, onIntentUpdate]);

  const offer = intent.offer;
  const awaitingPayment = intent.state === "awaiting_confirmation" && offer;

  return (
    <div>
      {intent.state === "retrieving_offer" || polling ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Fetching final pricing from the store…
        </div>
      ) : null}

      {intent.state === "placing_order" ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Placing your order…
        </div>
      ) : null}

      {offer ? (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-ink-secondary">
            <span>Subtotal</span>
            <span className="font-medium text-ink">
              {formatRyeMoney(offer.subtotal)}
            </span>
          </div>
          {offer.shipping ? (
            <div className="flex justify-between text-ink-secondary">
              <span>Shipping</span>
              <span className="font-medium text-ink">
                {formatRyeMoney(offer.shipping)}
              </span>
            </div>
          ) : null}
          {offer.tax ? (
            <div className="flex justify-between text-ink-secondary">
              <span>Tax</span>
              <span className="font-medium text-ink">
                {formatRyeMoney(offer.tax)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-hairline pt-3 text-base font-semibold text-ink">
            <span>Total</span>
            <span>{formatRyeMoney(offer.total)}</span>
          </div>
        </div>
      ) : null}

      {awaitingPayment && stripePromise ? (
        <Elements stripe={stripePromise}>
          <RyePaymentForm
            intentId={intent.id}
            confirming={confirming}
            setConfirming={setConfirming}
            searchId={searchId}
            productRef={productRef}
            productId={productId}
            title={title}
            brand={brand}
            color={color}
            onComplete={onComplete}
            onError={onError}
            onIntentUpdate={onIntentUpdate}
          />
        </Elements>
      ) : null}

      {awaitingPayment && !stripePromise ? (
        <p className="mt-4 text-xs text-ink-muted">
          Loading secure payment form…
        </p>
      ) : null}

      {onUseStoreCheckout ? (
        <button
          type="button"
          onClick={onUseStoreCheckout}
          className="mt-4 inline-flex h-10 w-full items-center justify-center text-[12px] font-medium text-ink-muted underline-offset-2 hover:text-brand hover:underline"
        >
          Use store checkout instead
        </button>
      ) : null}
    </div>
  );
}
