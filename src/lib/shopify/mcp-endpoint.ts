import {
  extractMcpEndpointFromDiscovery,
  fetchUcpDiscovery,
} from "@/lib/shopify/ucp-discovery-cache";

export type GetMcpEndpointOptions = {
  /**
   * When true, missing or invalid `/.well-known/ucp` discovery throws instead of guessing `/api/ucp/mcp`.
   * Defaults to true when `NODE_ENV === "production"` or `UCP_MCP_REQUIRE_DISCOVERY=1`.
   */
  requireDiscovery?: boolean;
};

function discoveryRequired(explicit?: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  if (process.env.UCP_MCP_REQUIRE_DISCOVERY === "1") return true;
  if (process.env.UCP_MCP_REQUIRE_DISCOVERY === "0") return false;
  return process.env.NODE_ENV === "production";
}

export async function getMcpEndpoint(
  merchantOrigin: string,
  options?: GetMcpEndpointOptions,
): Promise<string> {
  const origin = merchantOrigin.replace(/\/$/, "");
  const requireDisc = discoveryRequired(options?.requireDiscovery);
  let lastDetail = "Discovery did not include dev.ucp.shopping MCP transport with endpoint.";

  try {
    const discovery = await fetchUcpDiscovery(origin);
    const endpoint = extractMcpEndpointFromDiscovery(discovery);
    if (endpoint) return endpoint;
    lastDetail = "dev.ucp.shopping exists in discovery but no MCP transport with string endpoint was found.";
  } catch (e) {
    lastDetail = e instanceof Error ? e.message : String(e);
    if (requireDisc) {
      throw new Error(
        `UCP MCP discovery failed for ${origin}: ${lastDetail} Set UCP_MCP_REQUIRE_DISCOVERY=0 for development fallback to ${origin}/api/ucp/mcp.`,
      );
    }
  }

  if (requireDisc) {
    throw new Error(
      `UCP MCP discovery for ${origin} did not yield an MCP endpoint. ${lastDetail} Deploy with a valid /.well-known/ucp or set UCP_MCP_REQUIRE_DISCOVERY=0 only for local development.`,
    );
  }

  return `${origin}/api/ucp/mcp`;
}
