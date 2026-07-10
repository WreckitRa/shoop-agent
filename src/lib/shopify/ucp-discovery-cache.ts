import { readJsonRpcResponseBody } from "@/lib/shopify/mcp-parse";

export type UcpDiscoveryPayload = {
  ucp?: {
    services?: Record<string, unknown>;
    capabilities?: Record<string, unknown>;
  };
};

type CachedEntry = {
  payload: UcpDiscoveryPayload;
  fetchedAt: number;
};

const CACHE = new Map<string, CachedEntry>();
const TTL_MS = 15 * 60 * 1000;

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

/** Cached `/.well-known/ucp` fetch — shared by MCP endpoint resolution and merchant support. */
export async function fetchUcpDiscovery(origin: string): Promise<UcpDiscoveryPayload> {
  const key = normalizeOrigin(origin);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return hit.payload;
  }

  const res = await fetch(`${key}/.well-known/ucp`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`UCP discovery returned HTTP ${res.status}`);
  }

  const payload = (await readJsonRpcResponseBody(
    res,
    `Discovery document at ${key}/.well-known/ucp was not JSON.`,
  )) as UcpDiscoveryPayload;
  CACHE.set(key, { payload, fetchedAt: Date.now() });
  return payload;
}

export function extractMcpEndpointFromDiscovery(
  discovery: UcpDiscoveryPayload,
): string | null {
  const shopping = discovery.ucp?.services?.["dev.ucp.shopping"];
  const mcp =
    Array.isArray(shopping) &&
    shopping.find(
      (entry): entry is { transport?: string; endpoint?: string } =>
        Boolean(entry) &&
        typeof entry === "object" &&
        (entry as { transport?: unknown }).transport === "mcp",
    );
  return mcp && typeof mcp.endpoint === "string" ? mcp.endpoint : null;
}
