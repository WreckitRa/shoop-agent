/**
 * Embedded Checkout Protocol (ECP) — append query params to checkout `continue_url`.
 * @see docs/shopify-ucp-tutorial/carts-checkout/embedded-checkout.md
 */

const SHOPIFY_ECP_UCP_VERSION = "2026-01-23";

/**
 * Payment-only delegation — host implements Shop Pay / PSP sheets; no native shipping
 * address UI required. Recommended default for agents that don't also implement
 * `ec.fulfillment.address_change`.
 */
const ECP_DELEGATES_PAYMENT_ONLY = [
  "payment.instruments_change",
  "payment.credential",
] as const;

export type BuildEmbeddedCheckoutUrlOptions = {
  /**
   * Maps to `ec_auth` — **merchant-defined**, usually a short-lived JWT your **server**
   * issues per checkout (see Shopify's `fetchShopifyAuthenticationJWT()` example).
   * Omit when the merchant does not require it.
   */
  ecAuth?: string;
  /** Subset of delegations to request; defaults to payment-only. */
  ecDelegate?: string[];
};

/**
 * Returns a copy of the storefront handoff URL with the ECP query params applied.
 * Preserves existing query parameters.
 */
export function buildEmbeddedCheckoutContinueUrl(
  continueUrl: string,
  opts: BuildEmbeddedCheckoutUrlOptions = {},
): string {
  const u = new URL(continueUrl);
  u.searchParams.set("ec_version", SHOPIFY_ECP_UCP_VERSION);
  const auth = opts.ecAuth?.trim();
  if (auth) u.searchParams.set("ec_auth", auth);
  const delegates =
    opts.ecDelegate !== undefined ? opts.ecDelegate : [...ECP_DELEGATES_PAYMENT_ONLY];
  const joined = delegates.join(",");
  if (joined) u.searchParams.set("ec_delegate", joined);
  else u.searchParams.delete("ec_delegate");
  return u.toString();
}
