export type JsonRpcResponse<T> = {
  jsonrpc?: string;
  id?: number;
  result?: {
    structuredContent?: T;
    content?: Array<{ text?: string }>;
    isError?: boolean;
  };
  error?: { message?: string; code?: number; data?: unknown };
};

/**
 * Read JSON-RPC HTTP body; HTML usually means wrong URL or the store returned an error page.
 */
export async function readJsonRpcResponseBody(res: Response, detail: string): Promise<unknown> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`MCP returned an empty body (HTTP ${res.status}). ${detail}`);
  }
  if (trimmed.startsWith("<") || trimmed.toLowerCase().startsWith("<!doctype")) {
    const hint = trimmed.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`MCP returned HTML (HTTP ${res.status}), not JSON. ${detail} Snippet: ${hint}…`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `MCP returned non-JSON (HTTP ${res.status}). ${detail} Body: ${trimmed.slice(0, 240)}${trimmed.length > 240 ? "…" : ""}`,
    );
  }
}

/**
 * Read a JSON-RPC response body from the Global Catalog MCP.
 */
export async function readJsonRpcFromResponse(res: Response): Promise<unknown> {
  return readJsonRpcResponseBody(
    res,
    "Confirm SHOPIFY_CATALOG_MCP_URL or omit it to use https://catalog.shopify.com/api/ucp/mcp.",
  );
}

/** Appended to errors from {@link readMerchantUcpMcpResponse} so the client can offer a storefront fallback. */
export const MERCHANT_MCP_UNSUPPORTED_MARKER = "[UCP_MERCHANT_MCP_UNSUPPORTED]";

/**
 * Read JSON-RPC body from a store’s Cart / Checkout / Order MCP (`/api/ucp/mcp` or discovered endpoint).
 */
export async function readMerchantUcpMcpResponse(res: Response, mcpEndpointUrl: string): Promise<unknown> {
  try {
    return await readJsonRpcResponseBody(
      res,
      `Merchant endpoint was ${mcpEndpointUrl}. The shop may not publish UCP Cart MCP on this host, or discovery failed—check /.well-known/ucp on the storefront origin.`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${msg} ${MERCHANT_MCP_UNSUPPORTED_MARKER}`);
  }
}

/** Checkout payload may live under `checkout` or at the root of structuredContent. */
export function extractCheckoutFromMcpStructuredContent(sc: unknown): Record<string, unknown> | null {
  if (!sc || typeof sc !== "object") return null;
  const root = sc as Record<string, unknown>;
  const candidate =
    root.checkout && typeof root.checkout === "object"
      ? (root.checkout as Record<string, unknown>)
      : root;
  // Escalation responses may omit continue_url on the nested checkout; routes
  // fall back to cart/group continue URLs.
  if (typeof candidate.id === "string") {
    return candidate;
  }
  return null;
}

function formatMcpToolIsErrorMessage(r: NonNullable<JsonRpcResponse<unknown>["result"]>): string {
  const sc = r.structuredContent;
  if (sc && typeof sc === "object" && sc !== null && "messages" in sc) {
    const msgs = (sc as { messages?: unknown }).messages;
    const first = Array.isArray(msgs) ? msgs[0] : undefined;
    if (first && typeof first === "object" && first !== null) {
      const m = first as Record<string, unknown>;
      const parts = [m.code, m.severity, m.content].filter((x): x is string => typeof x === "string");
      if (parts.length) return parts.join(" — ");
    }
  }
  return JSON.stringify(r);
}

export function parseToolStructuredContent<T>(data: JsonRpcResponse<T>): T {
  if (data.error) {
    throw new Error(`JSON-RPC error: ${JSON.stringify(data.error)}`);
  }
  const r = data.result;
  if (!r) {
    throw new Error(`No result: ${JSON.stringify(data)}`);
  }
  if (r.isError) {
    throw new Error(`MCP tool error: ${formatMcpToolIsErrorMessage(r)}`);
  }
  if ("structuredContent" in r && r.structuredContent !== undefined) {
    return r.structuredContent as T;
  }
  const text = r.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text) as T;
    } catch {
      const head = text.length > 200 ? `${text.slice(0, 200)}…` : text;
      throw new Error(`MCP tool returned non-JSON text content: ${head}`);
    }
  }
  throw new Error(`No structuredContent: ${JSON.stringify(data)}`);
}
