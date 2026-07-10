import { fetchUcpDiscovery } from "@/lib/shopify/ucp-discovery-cache";

export type MerchantCommerceSupport = {
  origin: string;
  shopDomain: string;
  discoveryUrl: string;
  mcpEndpoint: string | null;
  cartSupported: boolean;
  checkoutSupported: boolean;
  /** True when Cart MCP and Checkout MCP can be negotiated for cart -> checkout conversion. */
  agenticCheckoutSupported: boolean;
  /** Shopify Cart MCP supports multi-line carts per merchant. Cross-merchant carts must be split. */
  multiItemCartSupported: boolean;
  buyNowSupported: boolean;
  embeddedCheckoutStage: "not_applicable" | "checkout_session_required";
  reason: string;
};

type UcpCapabilityMap = Record<string, unknown>;

function hasCapability(capabilities: UcpCapabilityMap | undefined, name: string): boolean {
  const value = capabilities?.[name];
  return Array.isArray(value) && value.length > 0;
}

function normalizeOrigin(raw: string): string {
  const url = new URL(raw);
  return url.origin.replace(/\/$/, "");
}

function shopDomain(origin: string): string {
  return new URL(origin).hostname.replace(/^www\./, "");
}

function fallbackSupport(origin: string, reason: string): MerchantCommerceSupport {
  return {
    origin,
    shopDomain: shopDomain(origin),
    discoveryUrl: `${origin}/.well-known/ucp`,
    mcpEndpoint: null,
    cartSupported: false,
    checkoutSupported: false,
    agenticCheckoutSupported: false,
    multiItemCartSupported: false,
    buyNowSupported: true,
    embeddedCheckoutStage: "not_applicable",
    reason,
  };
}

export async function getMerchantCommerceSupport(
  merchantOrigin: string,
): Promise<MerchantCommerceSupport> {
  const origin = normalizeOrigin(merchantOrigin);
  const discoveryUrl = `${origin}/.well-known/ucp`;

  try {
    const ucp = await fetchUcpDiscovery(origin);

    const shopping = ucp.ucp?.services?.["dev.ucp.shopping"];
    const mcp =
      Array.isArray(shopping) &&
      shopping.find(
        (entry): entry is { transport?: string; endpoint?: string } =>
          Boolean(entry) &&
          typeof entry === "object" &&
          (entry as { transport?: unknown }).transport === "mcp",
      );
    const mcpEndpoint =
      mcp && typeof mcp.endpoint === "string" ? mcp.endpoint : null;
    const capabilities = ucp.ucp?.capabilities;
    const cartSupported = Boolean(
      mcpEndpoint && hasCapability(capabilities, "dev.ucp.shopping.cart"),
    );
    const checkoutSupported = Boolean(
      mcpEndpoint && hasCapability(capabilities, "dev.ucp.shopping.checkout"),
    );
    const agenticCheckoutSupported = cartSupported && checkoutSupported;

    return {
      origin,
      shopDomain: shopDomain(origin),
      discoveryUrl,
      mcpEndpoint,
      cartSupported,
      checkoutSupported,
      agenticCheckoutSupported,
      multiItemCartSupported: cartSupported,
      buyNowSupported: true,
      embeddedCheckoutStage: checkoutSupported
        ? "checkout_session_required"
        : "not_applicable",
      reason: cartSupported
        ? agenticCheckoutSupported
          ? "Merchant advertises Shopify Cart MCP and Checkout MCP."
          : "Merchant advertises Shopify Cart MCP; checkout can still continue on the merchant storefront."
        : "Merchant does not advertise Shopify Cart MCP. Use the catalog checkout URL for buy-now.",
    };
  } catch (error) {
    return fallbackSupport(
      origin,
      error instanceof Error
        ? error.message
        : "Could not inspect merchant UCP discovery.",
    );
  }
}

export async function getMerchantCommerceSupportFromCheckoutUrl(
  checkoutUrl: string,
): Promise<MerchantCommerceSupport> {
  return getMerchantCommerceSupport(new URL(checkoutUrl).origin);
}
