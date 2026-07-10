import { logAiChat } from "@/lib/ai-chat/observability";

/**
 * Opt-in diagnostic logging for Checkout MCP buyer-IP resolution.
 * Set `SHOPIFY_DEBUG_CHECKOUT_IP=1` to enable. Keep OFF in production —
 * the diagnostic payloads include proxy headers that can be sensitive.
 */
function isCheckoutBuyerIpDebug(): boolean {
  return process.env.SHOPIFY_DEBUG_CHECKOUT_IP === "1";
}

export function logCheckoutBuyerIp(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isCheckoutBuyerIpDebug()) return;
  logAiChat("info", "shopify_checkout_buyer_ip", {
    message,
    ...(data ?? {}),
  });
}
