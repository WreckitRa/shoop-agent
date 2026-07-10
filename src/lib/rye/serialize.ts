import type { CheckoutIntent } from "checkout-intents/resources/checkout-intents/checkout-intents.js";
import type {
  RyeCheckoutIntentSnapshot,
  RyeMoney,
  RyeOffer,
} from "@/lib/rye/types";

function serializeMoney(
  money: { amountSubunits: number; currencyCode: string } | null | undefined,
): RyeMoney | null {
  if (!money) return null;
  return {
    amountSubunits: money.amountSubunits,
    currencyCode: money.currencyCode,
  };
}

function serializeOffer(
  offer: CheckoutIntent.AwaitingConfirmationCheckoutIntent["offer"] | undefined,
): RyeOffer | null {
  if (!offer) return null;
  return {
    subtotal: offer.cost.subtotal,
    tax: serializeMoney(offer.cost.tax) ?? { amountSubunits: 0, currencyCode: offer.cost.total.currencyCode },
    shipping: serializeMoney(offer.cost.shipping),
    total: offer.cost.total,
    selectedShippingOptionId: offer.shipping.selectedOptionId ?? null,
    shippingOptions: (offer.shipping.availableOptions ?? []).map((option) => ({
      id: option.id,
      cost: option.cost,
    })),
  };
}

export function serializeRyeCheckoutIntent(
  intent: CheckoutIntent,
): RyeCheckoutIntentSnapshot {
  const withOffer = intent as CheckoutIntent & {
    offer?: CheckoutIntent.AwaitingConfirmationCheckoutIntent["offer"];
    failureReason?: { code: string; message: string };
    orderId?: string | null;
  };

  return {
    id: intent.id,
    state: intent.state,
    productUrl: intent.productUrl,
    quantity: intent.quantity,
    offer: serializeOffer(withOffer.offer),
    failureReason: withOffer.failureReason
      ? {
          code: withOffer.failureReason.code,
          message: withOffer.failureReason.message,
        }
      : null,
    orderId: withOffer.orderId ?? null,
  };
}
