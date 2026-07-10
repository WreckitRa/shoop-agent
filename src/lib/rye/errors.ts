import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  type CheckoutIntentsError,
} from "checkout-intents";

export type RyeFailureCode =
  | "unknown"
  | "checkout_intent_expired"
  | "payment_failed"
  | "insufficient_stock"
  | "product_out_of_stock"
  | "offer_retrieval_failed"
  | "order_placement_failed"
  | "developer_not_found"
  | "missing_shipping_method"
  | "unsupported_currency"
  | "invalid_input"
  | "incorrect_cost_breakdown"
  | "unsupported_store_no_guest_checkout"
  | "workflow_invocation_failed"
  | "variant_selections_invalid"
  | "variant_selections_required"
  | "form_validation_error"
  | "captcha_blocked"
  | "bot_protection_blocked"
  | "constraint_total_price_exceeded"
  | "constraint_shipping_cost_exceeded"
  | "promo_code_discovery_not_enabled"
  | "product_not_found";

const SHOPIFY_FALLBACK_CODES = new Set<RyeFailureCode>([
  "offer_retrieval_failed",
  "unsupported_store_no_guest_checkout",
  "bot_protection_blocked",
  "captcha_blocked",
  "workflow_invocation_failed",
  "product_not_found",
  "missing_shipping_method",
  "unsupported_currency",
]);

/** Merchant/store cannot be fulfilled via Rye — use Shopify checkout instead. */
export function shouldFallbackToShopify(
  code: string | undefined | null,
): boolean {
  if (!code) return false;
  return SHOPIFY_FALLBACK_CODES.has(code as RyeFailureCode);
}

/** Buyer can fix details and retry with a new checkout intent. */
export function isRyeBuyerFixableFailure(code: string | undefined | null): boolean {
  if (!code) return false;
  return (
    code === "variant_selections_invalid" ||
    code === "variant_selections_required" ||
    code === "form_validation_error" ||
    code === "invalid_input" ||
    code === "constraint_total_price_exceeded" ||
    code === "constraint_shipping_cost_exceeded" ||
    code === "insufficient_stock" ||
    code === "product_out_of_stock"
  );
}

export function ryeFailureUserMessage(
  code: string | undefined | null,
  message: string | undefined | null,
): string {
  if (message?.trim()) return message.trim();
  switch (code) {
    case "variant_selections_invalid":
    case "variant_selections_required":
      return "We could not match that size or color. Update your selection and try again.";
    case "product_out_of_stock":
    case "insufficient_stock":
      return "This item is out of stock.";
    case "form_validation_error":
    case "invalid_input":
      return "Please review your shipping details and try again.";
    case "constraint_total_price_exceeded":
      return "The order total is higher than expected. Try again or use store checkout.";
    case "constraint_shipping_cost_exceeded":
      return "Shipping cost is higher than expected. Try again or use store checkout.";
    case "payment_failed":
      return "Payment could not be processed. Check your card details and try again.";
    case "checkout_intent_expired":
      return "This checkout session expired. Start again.";
    default:
      return "Checkout could not be completed. Please try again.";
  }
}

export function ryeHttpErrorMessage(error: unknown): string {
  if (error instanceof AuthenticationError) {
    return "Checkout authorization failed. Please try again later.";
  }
  if (error instanceof PermissionDeniedError) {
    return "Checkout is not available for this account.";
  }
  if (error instanceof RateLimitError) {
    return "Too many checkout attempts. Wait a moment and try again.";
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    const body = (error as CheckoutIntentsError & { error?: { message?: string } }).error;
    if (body?.message?.trim()) return body.message.trim();
    return "Please review your details and try again.";
  }
  if (error instanceof NotFoundError) {
    return "Checkout session not found. Start again.";
  }
  if (error instanceof ConflictError) {
    return "Checkout is already in progress. Refresh and try again.";
  }
  if (
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError ||
    error instanceof InternalServerError
  ) {
    return "Checkout service is temporarily unavailable. Try again shortly.";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Checkout could not be completed.";
}

export function ryeHttpShouldFallback(error: unknown): boolean {
  if (error instanceof NotFoundError) return true;
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    const body = error as CheckoutIntentsError & {
      error?: { code?: string; message?: string };
    };
    const code = body.error?.code;
    if (code && shouldFallbackToShopify(code)) return true;
    const message = body.error?.message?.toLowerCase() ?? "";
    if (message.includes("guest checkout") || message.includes("not supported")) {
      return true;
    }
  }
  return false;
}
