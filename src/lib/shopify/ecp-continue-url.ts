import { buildEmbeddedCheckoutContinueUrl } from "@/lib/shopify/embedded-checkout";

export type EmbeddedHandoffOptions = {
  /**
   * When your integration mints an `ec_auth` value per merchant docs, pass it here.
   * Omit to build a valid ECP URL with only `ec_version` / `ec_delegate` (UCP: `ec_auth` is optional).
   */
  ecAuth?: string;
  /** Override `ec_delegate`; when omitted, {@link buildEmbeddedCheckoutContinueUrl} uses payment-only defaults. */
  ecDelegate?: string[];
};

/** Embed-only ECP URL: ec_version only — no ec_delegate, no ec_auth on the URL. */
export function buildEmbedOnlyEmbeddedCheckoutContinueUrl(continueUrl: string): string {
  return buildEmbeddedCheckoutContinueUrl(continueUrl, {
    ecDelegate: [],
  });
}

/**
 * Augment `continue_url` for Embedded Checkout Protocol. Does **not** invent `ec_auth`.
 */
export function buildProductionEmbeddedCheckoutContinueUrl(
  continueUrl: string,
  options: EmbeddedHandoffOptions = {},
): string {
  return buildEmbeddedCheckoutContinueUrl(continueUrl, {
    ecAuth: options.ecAuth?.trim() || undefined,
    ecDelegate: options.ecDelegate,
  });
}
