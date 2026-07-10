import type { CheckoutMessage } from "@/lib/shopify/checkout-lifecycle";
import { checkoutUiPlan } from "@/lib/shopify/checkout-lifecycle";
import type { CartGroupCheckoutResponse } from "@/lib/cart/types";

export type ParsedMcpCheckoutError = {
  message: string;
  code?: string;
  severity?: string;
  content?: string;
};

/** MCP tool isError messages use `code — severity — content`. */
export function parseMcpToolCheckoutError(error: Error): ParsedMcpCheckoutError {
  const match = /^MCP tool error:\s*([^—]+?)\s*—\s*([^—]+?)\s*—\s*(.+)$/u.exec(
    error.message,
  );
  const code = match?.[1]?.trim();
  const severity = match?.[2]?.trim();
  const content = match?.[3]?.trim();
  return { code, severity, content, message: content ?? error.message };
}

export function isCheckoutStorefrontHandoff(params: {
  code?: string;
  severity?: string;
}): boolean {
  const { code, severity } = params;
  if (code === "MERCHANDISE_NOT_AVAILABLE") return false;
  return (
    code === "extension_interaction_required" ||
    severity === "requires_buyer_review"
  );
}

export function friendlyCheckoutError(error: Error): ParsedMcpCheckoutError {
  const parsed = parseMcpToolCheckoutError(error);
  const { code, severity, content } = parsed;

  if (code === "delivery_invalid_postal_code_for_country") {
    return {
      message: "Enter a valid ZIP / postal code for the selected country.",
      code,
      severity,
      content,
    };
  }
  if (code === "delivery_phone_number_required") {
    return {
      message: "Enter a phone number for delivery.",
      code,
      severity,
      content,
    };
  }
  if (code?.startsWith("delivery_")) {
    return {
      message: content ?? "Review the delivery details and try again.",
      code,
      severity,
      content,
    };
  }
  if (isCheckoutStorefrontHandoff({ code, severity })) {
    return {
      message:
        "This store needs you to finish checkout on their website — we'll open it for you.",
      code,
      severity,
      content,
    };
  }
  return {
    message:
      content ??
      "Something went wrong starting checkout. Try again or checkout on the store's website.",
    code,
    severity,
    content,
  };
}

export function checkoutMessageFromMcpError(
  parsed: ParsedMcpCheckoutError,
): CheckoutMessage | undefined {
  if (!parsed.code && !parsed.severity && !parsed.content) return undefined;
  return {
    code: parsed.code,
    severity: parsed.severity,
    content: parsed.content,
  };
}

export function buildStorefrontHandoffCheckoutResponse(opts: {
  shopDomain: string;
  mode: CartGroupCheckoutResponse["mode"];
  continueUrl: string;
  message?: CheckoutMessage;
}): CartGroupCheckoutResponse {
  const messages = opts.message ? [opts.message] : [];
  const plan = checkoutUiPlan("requires_escalation", messages);

  return {
    shopDomain: opts.shopDomain,
    mode: opts.mode,
    checkoutId: null,
    status: "requires_escalation",
    continueUrl: opts.continueUrl,
    messages,
    title: plan.title,
    detail: plan.detail,
  };
}
