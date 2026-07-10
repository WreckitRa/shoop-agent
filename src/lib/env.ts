function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/**
 * Global Catalog MCP — official endpoint per
 * https://shopify.dev/docs/agents/catalog/global-catalog
 * Dev Dashboard “Copy URL” may point here or may 404 if stale; omit env var to use this default.
 */
export const OFFICIAL_GLOBAL_CATALOG_MCP_URL = "https://catalog.shopify.com/api/ucp/mcp";

export function getCatalogMcpUrl(): string {
  const fromEnv = process.env.SHOPIFY_CATALOG_MCP_URL?.trim() || process.env.CATALOG_URL?.trim();
  if (fromEnv) return fromEnv;
  return OFFICIAL_GLOBAL_CATALOG_MCP_URL;
}

export function getShopifyClientId(): string {
  return required(
    "SHOPIFY_CATALOG_CLIENT_ID",
    process.env.SHOPIFY_CATALOG_CLIENT_ID ?? process.env.CLIENT_ID,
  );
}

export function getShopifyClientSecret(): string {
  return required(
    "SHOPIFY_CATALOG_CLIENT_SECRET",
    process.env.SHOPIFY_CATALOG_CLIENT_SECRET ?? process.env.CLIENT_SECRET,
  );
}

/** UCP-compliant Cache-Control for agent profiles (public + max-age only). */
export const UCP_AGENT_PROFILE_CACHE_CONTROL = "public, max-age=300";

/**
 * Tutorial cart + checkout profile — preferred HTTPS fallback for local dev.
 * @see docs/shopify-ucp-tutorial/define-a-profile.md
 */
export const SHOPIFY_CART_CHECKOUT_AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json";

/**
 * Shopify reference profile with Global Catalog (`get_product`, `search_catalog`, …).
 * @see https://shopify.dev/docs/agents/catalog/global-catalog
 */
export const SHOPIFY_CATALOG_REFERENCE_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";

/**
 * Full-capability HTTPS reference profile (catalog + cart + checkout + order, …).
 * @see docs/shopify-ucp-tutorial/monitor-orders.md
 */
export const SHOPIFY_REFERENCE_SHOPPING_AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";

function resolveHttpsAppOrigins(): string[] {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : undefined,
    process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.replace(/^https?:\/\//, "")}`
      : undefined,
  ];

  const origins: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
      if (parsed.protocol !== "https:" || seen.has(parsed.origin)) continue;
      seen.add(parsed.origin);
      origins.push(parsed.origin);
    } catch {
      /* ignore invalid URL */
    }
  }
  return origins;
}

function profileUrlForOrigin(origin: string): string {
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  return new URL("ucp-agent-profile.json", base).toString();
}

/**
 * Ordered profile URLs for Cart / Checkout / Order MCP (deduped).
 * Merchants fetch the first working URL — HTTPS only, Cache-Control must be UCP-valid.
 */
export function getShoppingAgentProfileCandidates(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined) => {
    const trimmed = url?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  add(process.env.AGENT_PROFILE_URL);
  for (const origin of resolveHttpsAppOrigins()) {
    add(profileUrlForOrigin(origin));
  }
  add(SHOPIFY_CART_CHECKOUT_AGENT_PROFILE);
  add(SHOPIFY_REFERENCE_SHOPPING_AGENT_PROFILE);

  return out;
}

/**
 * Primary profile URL for Cart / Checkout / Order MCP.
 *
 * - Set `AGENT_PROFILE_URL` to your deployed `https://…/ucp-agent-profile.json`.
 * - Set `NEXT_PUBLIC_APP_URL` (or platform URL vars) to an **https** origin to use
 *   `/ucp-agent-profile.json` on that host.
 * - On `http://localhost`, we fall back to Shopify’s HTTPS reference profiles.
 *
 * @see docs/shopify-ucp-tutorial/define-a-profile.md
 */
export function getShoppingAgentProfileUrl(): string {
  const candidates = getShoppingAgentProfileCandidates();
  return candidates[0] ?? SHOPIFY_CART_CHECKOUT_AGENT_PROFILE;
}

/** Merchant rejected the agent profile URL (cache headers, HTTP, unreachable). */
export function isShoppingProfileMalformedError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /profile_malformed|Invalid cache control|invalid_profile_url|Https required/i.test(
    msg,
  );
}

/** Catalog MCP profile lacks the requested tool (e.g. cart-only profile + get_product). */
export function isCatalogToolNotFoundError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /Tool not found/i.test(msg);
}

/**
 * Ordered profile URLs for Catalog MCP (search / lookup / get_product).
 * Falls back to Shopify’s HTTPS reference profiles when a custom URL is malformed.
 */
export function getCatalogAgentProfileCandidates(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined) => {
    const trimmed = url?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  add(process.env.SHOPIFY_CATALOG_UCP_PROFILE);
  // Global Catalog requires `dev.shopify.catalog.global` — try Shopify reference
  // profiles before this app's `/ucp-agent-profile.json` (cart/checkout only on older deploys).
  add(SHOPIFY_REFERENCE_SHOPPING_AGENT_PROFILE);
  add(SHOPIFY_CATALOG_REFERENCE_PROFILE);
  add(process.env.AGENT_PROFILE_URL);
  for (const origin of resolveHttpsAppOrigins()) {
    add(profileUrlForOrigin(origin));
  }
  add(SHOPIFY_CART_CHECKOUT_AGENT_PROFILE);

  return out;
}

/**
 * Primary profile URL for Catalog MCP (search / get_product).
 *
 * Prefer `SHOPIFY_CATALOG_UCP_PROFILE` when set to a **HTTPS** URL with UCP-valid
 * Cache-Control (`public, max-age=…` only — no `no-store` / `no-cache` / `private`).
 * On local dev, leave it unset so we use Shopify’s hosted reference profile.
 */
export function getCatalogAgentProfileUrl(): string {
  const candidates = getCatalogAgentProfileCandidates();
  return candidates[0] ?? SHOPIFY_CATALOG_REFERENCE_PROFILE;
}
