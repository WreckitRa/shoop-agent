import type { CartGroupCheckoutResponse } from "@/lib/cart/types";
import type { CheckoutEntity } from "@/lib/shopify/checkout";
import {
  checkoutUiPlan,
  isUnrecoverableCheckoutFailure,
  normalizeCheckoutStatus,
  parseCheckoutMessages,
  shouldHandoffToCheckoutKit,
  unrecoverableCheckoutUserMessage,
} from "@/lib/shopify/checkout-lifecycle";

export type CheckoutApiFailure = {
  error: string;
  status: number;
  code?: string;
  severity?: string;
  content?: string;
};

export type CheckoutApiResult =
  | { ok: true; checkout: CartGroupCheckoutResponse }
  | { ok: false; failure: CheckoutApiFailure };

export function buildCreateCheckoutResponse(input: {
  shopDomain: string;
  mode: CartGroupCheckoutResponse["mode"];
  checkout: CheckoutEntity;
  fallbackContinueUrl: string;
  groupContinueUrl?: string | null;
}): CheckoutApiResult {
  const messages = parseCheckoutMessages(input.checkout.messages);
  const status = normalizeCheckoutStatus(input.checkout.status);
  const continueUrl =
    input.checkout.continue_url?.trim() ||
    input.groupContinueUrl?.trim() ||
    input.fallbackContinueUrl;
  const plan = checkoutUiPlan(status, messages);

  if (isUnrecoverableCheckoutFailure(status, messages)) {
    const content = unrecoverableCheckoutUserMessage(messages);
    const code = messages.find((m) => m.code)?.code;
    return {
      ok: false,
      failure: {
        error: content,
        status: 422,
        code,
        severity: "requires_buyer_input",
        content,
      },
    };
  }

  if (!shouldHandoffToCheckoutKit(status, messages, continueUrl)) {
    return {
      ok: false,
      failure: {
        error: plan.detail,
        status: 422,
        content: plan.detail,
      },
    };
  }

  return {
    ok: true,
    checkout: {
      shopDomain: input.shopDomain,
      mode: input.mode,
      checkoutId: input.checkout.id,
      status: input.checkout.status ?? null,
      continueUrl,
      messages,
      title: plan.title,
      detail: plan.detail,
    },
  };
}
