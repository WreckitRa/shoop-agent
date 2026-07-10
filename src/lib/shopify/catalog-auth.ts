import { mintGlobalApiAccessToken } from "@/lib/shopify/auth";

/**
 * Bearer token for Catalog MCP `search_catalog` / `get_product`.
 *
 * Always mint the Global API client-credentials token. The hosted
 * `catalog.shopify.com` endpoint used to accept profile-only (no Bearer)
 * requests, but unauthenticated `search_catalog` currently hangs / 502s while
 * the same call with Bearer succeeds. Custom MCP URLs always needed the token.
 */
export async function accessTokenForCatalogMcp(): Promise<string> {
  const { access_token } = await mintGlobalApiAccessToken();
  return access_token;
}
