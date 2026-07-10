/**
 * Headers for authenticated UCP merchant MCP (e.g. Checkout / Order) with a Global API bearer.
 * Use `Shopify-Buyer-IP` on `/api/ucp/mcp` — documented mismatch: Storefront GraphQL uses
 * `Shopify-Storefront-Buyer-IP`; Checkout MCP expects `Shopify-Buyer-IP`
 * (see Shopify community thread on “Missing required buyer IP header”).
 * We send both so either path keeps working.
 */
export function ucpBearerAndBuyerIpHeaders(accessToken: string, buyerIp: string): Record<string, string> {
  const ip = buyerIp.trim();
  if (!ip) {
    throw new Error("Buyer IP is empty; fix buyer IP resolution before Checkout / Order MCP.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "Shopify-Buyer-IP": ip,
    "Shopify-Storefront-Buyer-IP": ip,
  };
}
