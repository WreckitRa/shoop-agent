/**
 * Global / Storefront Catalog MCP (UCP tools/call).
 * @see docs/shopify-ucp-tutorial/catalogs/about.md
 * @see docs/shopify-ucp-tutorial/catalogs/global-catalog-mcp.md
 *
 * Guidelines: do not cache search results or product images server-side; honor rate limits.
 */
import {
  getCatalogAgentProfileCandidates,
  getCatalogMcpUrl,
  isCatalogToolNotFoundError,
  isShoppingProfileMalformedError,
} from "@/lib/env";
import {
  JsonRpcResponse,
  parseToolStructuredContent,
  readJsonRpcFromResponse,
} from "@/lib/shopify/mcp-parse";
import type { CatalogMcpExchange } from "@/lib/shopify/catalog-mcp-audit";
import { buildCatalogMcpJsonRpcBody } from "@/lib/shopify/catalog-mcp-audit";
import { mcpToolsCallId } from "@/lib/shopify/mcp-request-id";
import { retryTransientMcp, withMcpRetry } from "@/lib/shopify/mcp-retry";
import {
  CURATED_SHOP_IDS,
  isCuratedShopAllowlistEnabled,
} from "@/lib/shopify/curated-shop-ids";
import { createAbortScope } from "@/lib/ai-chat/abort-scope";

/** Buyer localization / relevance signals (Global Catalog). */
export type CatalogSearchContext = {
  address_country?: string;
  address_region?: string;
  postal_code?: string;
  language?: string;
  currency?: string;
  intent?: string;
};

export type CatalogSearchFilters = {
  available?: boolean;
  condition?: string[];
  price?: { min?: number; max?: number };
  ships_to?: { country: string; region?: string; postal_code?: string };
  ships_from?: { country: string };
  shop_ids?: string[];
  /**
   * Taxonomy category filter. Each entry is a Shopify taxonomy GID string
   * (e.g. `gid://shopify/TaxonomyCategory/aa-1-13-8`). Multiple values use OR logic.
   */
  categories?: string[];
  /**
   * Shopify taxonomy attribute prefilter (Global Catalog extension).
   * Supported names: `Color`, `Size`, `Target gender`. Entries AND; values OR.
   * @see https://shopify.dev/docs/agents/catalog/global-catalog-extension
   */
  attributes?: CatalogTaxonomyAttributeFilter[];
};

/** One taxonomy attribute filter entry for `catalog.filters.attributes`. */
export type CatalogTaxonomyAttributeFilter = {
  name: string;
  values: string[];
};

/** Per-variant availability as returned by search/lookup/get_product. */
export type CatalogVariantAvailability = {
  available?: boolean;
  status?: string;
  running_low?: boolean;
};

/**
 * Catalog media envelope. Shape varies (`media: [{ url }]`, `featured_image: { src }`,
 * `image: "https://…"`). Keep all variants optional so we can extract a URL defensively.
 */
export type CatalogMediaItem = {
  url?: string;
  src?: string;
  href?: string;
  alt?: string;
  preview?: { url?: string; src?: string };
};

export type SelectedOption = { name: string; label: string };

/** Featured offer variant on `search_catalog` product hits (not full matrix). */
export type CatalogVariantSummary = {
  id: string;
  title?: string;
  price?: { amount: number; currency: string };
  checkout_url?: string;
  options?: SelectedOption[];
  media?: CatalogMediaItem[];
  featured_image?: CatalogMediaItem | string;
  image?: CatalogMediaItem | string;
  /** Stock signal for this offer — present on search/lookup responses. */
  availability?: CatalogVariantAvailability;
};

/** Normalized featured variant for chat cards and PDP deep links. */
export type SearchFeaturedVariant = {
  id: string;
  price?: { amount: number; currency: string };
  checkoutUrl?: string;
  options?: SelectedOption[];
};

export function searchFeaturedVariantFromProduct(
  product: CatalogProductSummary | null | undefined,
): SearchFeaturedVariant | undefined {
  if (!product) return undefined;
  const raw =
    product.variants?.find((v) => isVariantStockPurchasable(v)) ??
    product.variants?.find((v) => v.id && v.checkout_url);
  if (!raw?.id) return undefined;
  const options: SelectedOption[] = [];
  for (const o of raw.options ?? []) {
    if (typeof o.name === "string" && typeof o.label === "string") {
      options.push({ name: o.name, label: o.label });
    }
  }
  return {
    id: raw.id,
    price: raw.price,
    checkoutUrl: raw.checkout_url,
    options: options.length ? options : undefined,
  };
}

export type CatalogProductSummary = {
  id: string;
  title: string;
  options?: Array<{
    name: string;
    values: Array<{ label: string }>;
  }>;
  /** Featured offer variant(s) from search — typically one entry. */
  variants?: CatalogVariantSummary[];
  price_range?: {
    min: { amount: number; currency: string };
    max: { amount: number; currency: string };
  };
  /** Best-effort: may be `media[]`, `featured_image`, or `image` depending on view. */
  media?: CatalogMediaItem[];
  featured_image?: CatalogMediaItem | string;
  image?: CatalogMediaItem | string;
  /** Product-level rating — Global Catalog search returns this inline. */
  rating?: unknown;
  /** ML-inferred metadata from Global Catalog (when present). */
  metadata?: {
    attributes?: unknown;
    tech_specs?: unknown;
    top_features?: unknown;
    unique_selling_points?: unknown;
  };
};

export type CatalogSearchResult = {
  products?: CatalogProductSummary[];
  pagination?: CatalogSearchPagination;
};

/** Cursor pagination metadata from `search_catalog`. */
export type CatalogSearchPagination = {
  cursor?: string;
  has_next_page?: boolean;
  /** Estimated total matches — can exceed fetchable depth. */
  total_count?: number;
};

/**
 * Page size per `search_catalog` request.
 * Fashion pipeline targets 100 results/query; Shopify Global Catalog docs
 * historically listed max 50 — we request up to this constant and clamp here.
 */
export const CATALOG_SEARCH_PAGE_LIMIT = 100;

/** Max products fetchable via cursor pagination for one query. */
export const CATALOG_SEARCH_MAX_DEPTH = 1000;

/** Product-level rating from Global Catalog `get_product` (when merchant exposes it). */
export type CatalogProductRating = {
  value: number;
  scaleMax: number;
  count: number;
};

export type CatalogProductDetail = {
  id: string;
  title: string;
  /** Storefront product page URL (used for Rye Universal Checkout). */
  url?: string;
  /** Catalog brand when provided; otherwise derive from title in the UI. */
  brand?: string;
  rating?: CatalogProductRating;
  description?: { html?: string; text?: string };
  options?: Array<{
    name: string;
    values: Array<{ label: string; available?: boolean; exists?: boolean }>;
  }>;
  selected?: SelectedOption[];
  variants?: Array<{
    id: string;
    title?: string;
    /** Variant storefront URL (already includes `?variant=…`); preferred for Rye. */
    url?: string;
    price?: { amount: number; currency: string };
    checkout_url?: string;
    /** Variant-level image (sometimes returned with a media array; sometimes a single object). */
    media?: CatalogMediaItem[];
    image?: CatalogMediaItem | string;
    availability?: {
      available?: boolean;
      status?: string;
      running_low?: boolean;
    };
    seller?: {
      name?: string;
      domain?: string;
      url?: string;
    };
    options?: Array<{ name: string; label: string }>;
  }>;
  /** Product-level media gallery. */
  media?: CatalogMediaItem[];
  featured_image?: CatalogMediaItem | string;
  image?: CatalogMediaItem | string;
  /** Some catalog views attach the seller at the product root. */
  seller?: {
    name?: string;
    domain?: string;
    url?: string;
  };
  /** ML-inferred metadata from Global Catalog (when present). */
  metadata?: CatalogProductSummary["metadata"];
};

export type GetProductResult = {
  product?: CatalogProductDetail;
};

/** Normalized stock state for the resolved/purchasable variant of a product. */
export type StockStatus =
  | "in_stock"
  | "running_low"
  | "out_of_stock"
  | "unknown";

/**
 * Buyer-aware availability snapshot for a single product, derived from a
 * `get_product` call that was scoped to the buyer's preferred options +
 * shipping destination. This is what lets Shoop avoid recommending an item
 * that is out of the buyer's size or won't ship to them.
 */
export type CardAvailability = {
  /** Stock status of the resolved (preferred) variant. */
  status: StockStatus;
  /**
   * Whether the buyer's preferred option labels (e.g. their size) are all
   * available as requested. `null` when there were no preferred options or the
   * catalog gave no signal.
   */
  preferredMatched: boolean | null;
  /** Short human note when the exact size/color was relaxed or sold out. */
  relaxedNote?: string;
  /** True when the resolved variant exposes a checkout URL (purchasable). */
  purchasable: boolean;
  /** True when the product is verified to ship to the buyer's country. */
  shippable: boolean | null;
  /** Size label match was low-confidence — buyer should confirm before purchase. */
  sizeNeedsVerification?: boolean;
};

function labelsEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function normalizeStockStatus(
  variant:
    | {
        checkout_url?: string;
        availability?: CatalogVariantAvailability;
      }
    | undefined,
): StockStatus {
  const a = variant?.availability;
  if (!a) return "unknown";
  if (a.available === false) return "out_of_stock";
  const raw = a.status?.toLowerCase();
  if (raw === "out_of_stock" || raw === "sold_out") return "out_of_stock";
  if (raw === "running_low" || a.running_low === true) return "running_low";
  if (raw === "in_stock") return "in_stock";
  if (a.available === true) return "in_stock";
  return "unknown";
}

type VariantStockProbe = {
  checkout_url?: string;
  availability?: CatalogVariantAvailability;
};

/** True when the variant has a checkout URL and an explicit in-stock signal. */
export function isVariantStockPurchasable(
  variant: VariantStockProbe | null | undefined,
): boolean {
  if (!variant?.checkout_url) return false;
  const status = normalizeStockStatus(variant);
  return status === "in_stock" || status === "running_low";
}

/** True when a search hit exposes at least one buy-ready offer variant. */
export function productSearchSummaryInStock(
  product: CatalogProductSummary,
): boolean {
  return (product.variants ?? []).some((v) => isVariantStockPurchasable(v));
}

/** Strict buyer-facing gate: unknown stock is not buy-ready. */
export function isCardAvailabilityPurchasable(
  availability: CardAvailability | undefined | null,
): boolean {
  if (!availability?.purchasable) return false;
  if (availability.status === "out_of_stock") return false;
  if (availability.preferredMatched === false) return false;
  return (
    availability.status === "in_stock" || availability.status === "running_low"
  );
}

/**
 * Determine whether the buyer's preferred variant is actually available, and
 * whether the catalog had to relax the selection (e.g. their size sold out).
 *
 * `product` should come from `get_product` scoped to the preferred options
 * (and ideally `filters.available = true` + `ships_to`), so `product.selected`
 * reflects the effective selection and option values carry `available` flags.
 */
export function summarizePreferredAvailability(
  product: CatalogProductDetail,
  preferred: SelectedOption[],
  shippable: boolean | null = null,
): CardAvailability {
  const variant =
    product.variants?.find((v) => isVariantStockPurchasable(v)) ??
    product.variants?.find((v) => v.id && v.checkout_url) ??
    product.variants?.[0];
  const status = normalizeStockStatus(variant);
  const purchasable = isVariantStockPurchasable(variant);

  if (!preferred.length) {
    return { status, preferredMatched: null, purchasable, shippable };
  }

  const effective = new Map(
    (product.selected ?? []).map((s) => [s.name.toLowerCase(), s.label]),
  );

  const relaxedParts: string[] = [];
  let anySignal = false;
  let allMatched = true;

  for (const pref of preferred) {
    const opt = product.options?.find((o) => labelsEqual(o.name, pref.name));
    const value = opt?.values.find((v) => labelsEqual(v.label, pref.label));

    if (value && (value.available === false || value.exists === false)) {
      anySignal = true;
      allMatched = false;
      relaxedParts.push(`${pref.name} ${pref.label} sold out`);
      continue;
    }

    const eff = effective.get(pref.name.toLowerCase());
    if (eff != null) {
      anySignal = true;
      if (!labelsEqual(eff, pref.label)) {
        allMatched = false;
        relaxedParts.push(`${pref.name} ${pref.label}→${eff}`);
      }
    }
  }

  return {
    status,
    preferredMatched: anySignal ? allMatched : null,
    relaxedNote: relaxedParts.length
      ? `${relaxedParts.join("; ")} — closest available shown`
      : undefined,
    purchasable,
    shippable,
  };
}

/**
 * Build a coarse availability snapshot from a search/lookup variant. Search
 * results expose the featured offer's stock signal but no per-size matrix, so
 * `preferredMatched` is left `null` (size verification happens later via
 * `get_product`). This gives every card an instant in/out-of-stock signal with
 * zero extra round-trips.
 */
export function availabilityFromSearchVariant(
  variant: CatalogVariantSummary | undefined,
  shippable: boolean | null = null,
): CardAvailability | undefined {
  if (!variant) return undefined;
  const a = variant.availability;
  const purchasable = isVariantStockPurchasable(variant);
  let status: StockStatus;
  if (!a) {
    status = "unknown";
  } else if (a.available === false) {
    status = "out_of_stock";
  } else {
    const raw = a.status?.toLowerCase();
    if (raw === "out_of_stock" || raw === "sold_out") status = "out_of_stock";
    else if (raw === "running_low" || a.running_low === true)
      status = "running_low";
    else if (raw === "in_stock" || a.available === true) status = "in_stock";
    else status = "unknown";
  }
  return { status, preferredMatched: null, purchasable, shippable };
}

export type CatalogLookupResult = {
  products?: CatalogProductSummary[];
};

export type GetProductOptions = {
  context?: CatalogSearchContext;
  /** Option names; server relaxes from the end first when no exact variant. @see global-catalog-mcp.md */
  preferences?: string[];
  filters?: Pick<
    CatalogSearchFilters,
    "available" | "condition" | "ships_to" | "ships_from"
  >;
  /** @example "summary" | "offer" — see Global Catalog extension / MCP reference */
  view?: string;
  signal?: AbortSignal;
  /** Admin audit: full MCP request/response per HTTP call. */
  onMcpExchange?: (exchange: CatalogMcpExchange) => void;
};

/**
 * `catalog.like` input — find products similar to a known product/variant id or
 * to an image. @see global-catalog-mcp.md
 */
export type CatalogLikeItem =
  | { id: string }
  | { image: { content_type: string; data: string } };

export type SearchCatalogOptions = {
  context?: CatalogSearchContext;
  view?: string;
  /** Similar-items search (image or product/variant ids). */
  like?: CatalogLikeItem[];
  /** Page size: 1–50, server default 10. @see global-catalog-mcp.md */
  limit?: number;
  /** Opaque cursor from a prior `search_catalog` response. */
  cursor?: string;
  signal?: AbortSignal;
  /** Admin audit: full MCP request/response per HTTP call. */
  onMcpExchange?: (exchange: CatalogMcpExchange) => void;
};

/**
 * Global Catalog MCP — always send the Global API Bearer token.
 * Profile-only (no Bearer) requests to catalog.shopify.com currently hang / 502.
 */
function catalogHeaders(accessToken: string): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken.trim()) {
    h.Authorization = `Bearer ${accessToken}`;
  }
  return h;
}

function pruneFilters(f: CatalogSearchFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      Object.keys(v as object).length === 0
    ) {
      continue;
    }
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function pruneContext(c: CatalogSearchContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Best-effort: extract the first image URL from a catalog product/variant.
 * Shopify renders different media envelopes per view; this picks the first viable one.
 * Returns `null` when no image is present (caller renders a placeholder).
 *
 * Guideline: per docs, images must be rendered in real-time from the source URL — never
 * cache or download server-side. The returned URL is used directly in <img src>.
 */
export function extractCatalogImageUrl(
  src:
    | Pick<CatalogProductSummary, "media" | "featured_image" | "image">
    | Pick<CatalogProductDetail, "media" | "featured_image" | "image">
    | { media?: CatalogMediaItem[]; image?: CatalogMediaItem | string }
    | null
    | undefined,
): string | null {
  if (!src) return null;
  const pick = (m: CatalogMediaItem | string | undefined): string | null => {
    if (!m) return null;
    if (typeof m === "string") return m.trim() || null;
    return (
      m.url?.trim() ||
      m.src?.trim() ||
      m.href?.trim() ||
      m.preview?.url?.trim() ||
      m.preview?.src?.trim() ||
      null
    );
  };
  const fromArray = (arr?: CatalogMediaItem[]) => {
    if (!Array.isArray(arr)) return null;
    for (const item of arr) {
      const url = pick(item);
      if (url) return url;
    }
    return null;
  };
  return (
    fromArray(src.media) ??
    pick(
      (src as { featured_image?: CatalogMediaItem | string }).featured_image,
    ) ??
    pick(src.image) ??
    null
  );
}

function mediaItemUrl(m: CatalogMediaItem | string | undefined): string | null {
  if (!m) return null;
  if (typeof m === "string") return m.trim() || null;
  return (
    m.url?.trim() ||
    m.src?.trim() ||
    m.href?.trim() ||
    m.preview?.url?.trim() ||
    m.preview?.src?.trim() ||
    null
  );
}

/** All unique image URLs for a product, variant-first when a variant is resolved. */
export function collectCatalogImageUrls(
  detail: CatalogProductDetail | null | undefined,
  variant?: CatalogProductDetail["variants"] extends (infer V)[] | undefined
    ? V | null
    : null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushUrl = (url: string | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  const pushSource = (
    src:
      | Pick<CatalogProductDetail, "media" | "featured_image" | "image">
      | null
      | undefined,
  ) => {
    if (!src) return;
    if (Array.isArray(src.media)) {
      for (const item of src.media) pushUrl(mediaItemUrl(item));
    }
    pushUrl(
      mediaItemUrl(
        (src as { featured_image?: CatalogMediaItem | string }).featured_image,
      ),
    );
    pushUrl(mediaItemUrl(src.image));
  };

  if (variant) pushSource(variant);
  if (detail) pushSource(detail);
  return out;
}

export function productPagePath(productId: string): string {
  return `/product/${encodeURIComponent(productId)}`;
}

/** Map search filters to buyer `catalog.context` (Global Catalog examples use this with `ships_to`). */
export function catalogContextFromSearchFilters(
  filters: CatalogSearchFilters,
): CatalogSearchContext | undefined {
  const st = filters.ships_to;
  if (!st) return undefined;
  const ctx: CatalogSearchContext = {};
  if (st.country) ctx.address_country = st.country;
  if (st.region) ctx.address_region = st.region;
  if (st.postal_code) ctx.postal_code = st.postal_code;
  return Object.keys(ctx).length ? ctx : undefined;
}

/**
 * Merge buyer localization with ships_to-derived context for every catalog call.
 * Buyer `currency` / `language` win; `address_*` fields come from filters when set.
 */
export function buildCatalogCallContext(
  filters: CatalogSearchFilters,
  buyerContext?: CatalogSearchContext,
  intent?: string,
): CatalogSearchContext | undefined {
  const fromFilters = catalogContextFromSearchFilters(filters);
  const merged: CatalogSearchContext = {
    ...(buyerContext ?? {}),
    ...(fromFilters ?? {}),
  };
  const resolvedIntent = intent ?? buyerContext?.intent;
  if (resolvedIntent) merged.intent = resolvedIntent;
  if (merged.currency?.trim()) {
    merged.currency = merged.currency.trim().toUpperCase().slice(0, 6);
  }
  return Object.keys(merged).length ? merged : undefined;
}

async function callCatalogTool<T>(
  accessToken: string,
  toolName: string,
  catalogArgs: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onMcpExchange?: (exchange: CatalogMcpExchange) => void;
  },
): Promise<T> {
  const url = getCatalogMcpUrl();
  const candidates = getCatalogAgentProfileCandidates();
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const profileUrl = candidates[i]!;
    const requestId = mcpToolsCallId();
    const requestBody = buildCatalogMcpJsonRpcBody(
      toolName,
      catalogArgs,
      profileUrl,
      requestId,
    );
    try {
      return await retryTransientMcp(
        async () => {
          const res = await withMcpRetry(
            () =>
              fetch(url, {
                method: "POST",
                headers: catalogHeaders(accessToken),
                signal: options?.signal,
                body: JSON.stringify(requestBody),
              }),
            3,
            options?.signal,
          );
          const data = (await readJsonRpcFromResponse(
            res,
          )) as JsonRpcResponse<T>;
          options?.onMcpExchange?.({
            mcpUrl: url,
            agentProfileUrl: profileUrl,
            httpStatus: res.status,
            requestBody,
            responseBody: data,
          });
          return parseToolStructuredContent(data);
        },
        { signal: options?.signal },
      );
    } catch (error) {
      lastError = error;
      const recoverable =
        isShoppingProfileMalformedError(error) ||
        isCatalogToolNotFoundError(error);
      const hasNext = i < candidates.length - 1;
      if (!recoverable || !hasNext) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Catalog MCP failed: no agent profile URL configured.");
}

/**
 * Max `filters.shop_ids` per `search_catalog` call.
 * Shopify has historically hung / returned -32000 when sent ~460 at once;
 * chunking keeps every request under this size. Set env to `0` to send the
 * full list in one call.
 */
export const CATALOG_SHOP_IDS_CHUNK_SIZE_DEFAULT = 100;

export function getCatalogShopIdsChunkSize(): number {
  const raw = process.env.CATALOG_SHOP_IDS_CHUNK_SIZE?.trim();
  if (raw === undefined || raw === "") return CATALOG_SHOP_IDS_CHUNK_SIZE_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return CATALOG_SHOP_IDS_CHUNK_SIZE_DEFAULT;
  if (n === 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(n));
}

/** Split shop GIDs into request-sized cohorts. */
export function chunkShopIds(
  shopIds: readonly string[],
  chunkSize: number = getCatalogShopIdsChunkSize(),
): string[][] {
  if (shopIds.length === 0) return [];
  if (!Number.isFinite(chunkSize) || shopIds.length <= chunkSize) {
    return [[...shopIds]];
  }
  const size = Math.max(1, Math.floor(chunkSize));
  const out: string[][] = [];
  for (let i = 0; i < shopIds.length; i += size) {
    out.push(shopIds.slice(i, i + size));
  }
  return out;
}

/**
 * Round-robin merge so early shops in the allowlist don't dominate rankings.
 * Dedupes by product id (first win).
 */
export function mergeCatalogProductPages(
  pages: readonly (readonly CatalogProductSummary[])[],
): CatalogProductSummary[] {
  const seen = new Set<string>();
  const out: CatalogProductSummary[] = [];
  let i = 0;
  let progress = true;
  while (progress) {
    progress = false;
    for (const page of pages) {
      if (i >= page.length) continue;
      progress = true;
      const product = page[i]!;
      if (!product.id || seen.has(product.id)) continue;
      seen.add(product.id);
      out.push(product);
    }
    i += 1;
  }
  return out;
}

/**
 * Merge caller filters with the curated shop allowlist.
 * When the allowlist is on, every `search_catalog` is scoped to those shops
 * (intersected with any caller-supplied `shop_ids`).
 *
 * Empty intersection yields `shop_ids: []` (never drops the filter — callers
 * must treat that as zero results, not global search).
 */
export function applyCuratedShopAllowlist(
  filters: CatalogSearchFilters,
): CatalogSearchFilters {
  if (!isCuratedShopAllowlistEnabled()) return filters;
  const allow = CURATED_SHOP_IDS as readonly string[];
  const caller = filters.shop_ids?.filter(Boolean);
  const shop_ids =
    caller && caller.length > 0
      ? caller.filter((id) => allow.includes(id))
      : [...allow];
  return { ...filters, shop_ids };
}

function resolvedSearchLimit(options: SearchCatalogOptions): number {
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    return Math.min(
      CATALOG_SEARCH_PAGE_LIMIT,
      Math.max(1, Math.round(options.limit)),
    );
  }
  return CATALOG_SEARCH_PAGE_LIMIT;
}

/** Canonical `search_catalog` tool args (one page). */
export function buildSearchCatalogRequest(
  query: string,
  filters: CatalogSearchFilters = {},
  options: SearchCatalogOptions = {},
): Record<string, unknown> {
  const filterObj = pruneFilters({
    ...applyCuratedShopAllowlist(filters),
    available: true,
  });
  const contextObj = pruneContext({
    ...options.context,
  });
  const catalog: Record<string, unknown> = {};
  if (query.trim()) catalog.query = query;
  if (options.like?.length) catalog.like = options.like;
  if (Object.keys(filterObj).length) catalog.filters = filterObj;
  if (Object.keys(contextObj).length) catalog.context = contextObj;
  if (options.view) catalog.view = options.view;
  const pagination: Record<string, unknown> = {};
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    pagination.limit = resolvedSearchLimit(options);
  }
  if (options.cursor?.trim()) {
    pagination.cursor = options.cursor.trim();
  }
  if (Object.keys(pagination).length) {
    catalog.pagination = pagination;
  }
  return catalog;
}

/**
 * One `search_catalog` page. When the curated allowlist (or caller `shop_ids`)
 * exceeds {@link getCatalogShopIdsChunkSize}, fans out parallel chunked
 * requests and merges — so every network call stays shop-scoped.
 */
export async function searchCatalog(
  accessToken: string,
  query: string,
  filters: CatalogSearchFilters = {},
  options: SearchCatalogOptions = {},
): Promise<CatalogSearchResult> {
  const scoped = applyCuratedShopAllowlist(filters);

  // Allowlist intersected to nothing → do not fall through to global search.
  if (Array.isArray(scoped.shop_ids) && scoped.shop_ids.length === 0) {
    return { products: [], pagination: { has_next_page: false, total_count: 0 } };
  }

  const shopIds = scoped.shop_ids;
  const chunks =
    shopIds && shopIds.length > 0
      ? chunkShopIds(shopIds, getCatalogShopIdsChunkSize())
      : [undefined];

  // Single cohort (no shop filter, or one chunk) — preserve cursor pagination.
  if (chunks.length <= 1) {
    const catalog = buildSearchCatalogRequest(
      query,
      chunks[0] ? { ...scoped, shop_ids: chunks[0] } : scoped,
      options,
    );
    return callCatalogTool<CatalogSearchResult>(
      accessToken,
      "search_catalog",
      catalog,
      {
        signal: options.signal,
        onMcpExchange: options.onMcpExchange,
      },
    );
  }

  // Cross-chunk cursors aren't meaningful — the first merged page already
  // searches every shop cohort. Further pages would only deepen within cohorts.
  if (options.cursor?.trim()) {
    return { products: [], pagination: { has_next_page: false } };
  }

  const limit = resolvedSearchLimit(options);
  // Fork per chunk so parallel fetches don't stack abort listeners on one signal
  // (Node warns at 100+ listeners — full curated allowlist is ~5 chunks × retries).
  const scope = createAbortScope(options.signal);
  const pages = await Promise.all(
    chunks.map((chunk) => {
      const catalog = buildSearchCatalogRequest(
        query,
        { ...scoped, shop_ids: chunk },
        { ...options, cursor: undefined, limit },
      );
      return callCatalogTool<CatalogSearchResult>(
        accessToken,
        "search_catalog",
        catalog,
        {
          signal: scope.fork(),
          onMcpExchange: options.onMcpExchange,
        },
      );
    }),
  );

  const merged = mergeCatalogProductPages(pages.map((p) => p.products ?? []));
  const totalCount = pages.reduce(
    (sum, p) => sum + (p.pagination?.total_count ?? 0),
    0,
  );
  return {
    products: merged.slice(0, limit),
    pagination: {
      has_next_page: false,
      total_count: totalCount || merged.length,
    },
  };
}

/** Resolve up to 50 IDs (Global Catalog) — see about.md / global-catalog-mcp.md */
export async function lookupCatalog(
  accessToken: string,
  ids: string[],
  opts?: {
    filters?: Pick<
      CatalogSearchFilters,
      "available" | "condition" | "ships_to" | "ships_from"
    >;
    context?: CatalogSearchContext;
    view?: string;
  },
): Promise<CatalogLookupResult> {
  if (!ids.length) {
    return { products: [] };
  }
  const filterObj = opts?.filters
    ? pruneFilters(opts.filters as CatalogSearchFilters)
    : {};
  const contextObj = opts?.context ? pruneContext(opts.context) : {};
  const catalog: Record<string, unknown> = { ids };
  if (Object.keys(filterObj).length) catalog.filters = filterObj;
  if (Object.keys(contextObj).length) catalog.context = contextObj;
  if (opts?.view) catalog.view = opts.view;

  return callCatalogTool<CatalogLookupResult>(
    accessToken,
    "lookup_catalog",
    catalog,
  );
}

export function parseCatalogRating(
  raw: unknown,
): CatalogProductRating | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const value = typeof r.value === "number" ? r.value : null;
  const count = typeof r.count === "number" ? r.count : null;
  if (value == null || count == null || count < 0) return undefined;
  const scaleMax =
    typeof r.scale_max === "number"
      ? r.scale_max
      : typeof r.scaleMax === "number"
        ? r.scaleMax
        : 5;
  return { value, scaleMax, count: Math.round(count) };
}

function parseCatalogBrand(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length ? t : undefined;
}

function pickCatalogString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function shopDomainFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

function parseCatalogSeller(raw: unknown): CatalogProductDetail["seller"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const name = pickCatalogString(r, "name", "shop_name", "shopName", "title");
  let domain = pickCatalogString(r, "domain", "shop_domain", "shopDomain");
  const url = pickCatalogString(
    r,
    "url",
    "shop_url",
    "shopUrl",
    "store_url",
    "storeUrl",
  );
  if (!domain) domain = shopDomainFromUrl(url);
  if (!name && !domain && !url) return undefined;
  return { name, domain, url };
}

function parseVariantCheckoutUrl(
  raw: Record<string, unknown>,
): string | undefined {
  return pickCatalogString(
    raw,
    "checkout_url",
    "checkoutUrl",
    "cart_url",
    "cartUrl",
    "permalink",
  );
}

type CatalogVariant = NonNullable<CatalogProductDetail["variants"]>[number];

function normalizeCatalogVariant(raw: CatalogVariant): CatalogVariant {
  const r = raw as CatalogVariant & Record<string, unknown>;
  const checkout_url = parseVariantCheckoutUrl(r);
  const seller = parseCatalogSeller(
    r.seller ?? r.shop ?? r.merchant ?? r.store,
  );
  return {
    ...raw,
    ...(checkout_url ? { checkout_url } : {}),
    ...(seller ? { seller } : {}),
  };
}

/** First in-stock variant with a checkout permalink — scans all offers. */
export function resolvePurchasableVariant(
  product: CatalogProductDetail | null | undefined,
): CatalogVariant | null {
  if (!product?.variants?.length) return null;
  for (const variant of product.variants) {
    if (variant.id && isVariantStockPurchasable(variant)) return variant;
  }
  return null;
}

/**
 * Variant for the buyer's current option picks. Returns null until every option
 * axis is chosen so CTAs stay disabled instead of targeting the wrong offer.
 */
export function resolveSelectedPurchasableVariant(
  product: CatalogProductDetail | null | undefined,
  selectedOptions: Record<string, string>,
): CatalogVariant | null {
  if (!product?.variants?.length) return null;
  const optionNames = product.options ?? [];
  const allPicked =
    !optionNames.length ||
    optionNames.every((opt) => Boolean(selectedOptions[opt.name]?.trim()));
  if (!allPicked) return null;

  const primary = product.variants[0];
  if (primary?.id && isVariantStockPurchasable(primary)) return primary;

  return resolvePurchasableVariant(product);
}

export function resolveCatalogSeller(
  product: CatalogProductDetail | null | undefined,
  variant?: CatalogVariant | null,
): { name: string | null; domain: string | null } {
  const fromSeller = (
    seller: CatalogProductDetail["seller"] | undefined,
  ): { name: string | null; domain: string | null } | null => {
    if (!seller) return null;
    const name = seller.name?.trim() || null;
    let domain = seller.domain?.trim() || null;
    if (!domain) domain = shopDomainFromUrl(seller.url) ?? null;
    if (!name && !domain) return null;
    return { name, domain };
  };

  const productSeller = fromSeller(product?.seller);
  if (productSeller) return productSeller;

  const primary =
    variant ?? resolvePurchasableVariant(product) ?? product?.variants?.[0];
  const variantSeller = fromSeller(primary?.seller);
  if (variantSeller) return variantSeller;

  for (const cand of product?.variants ?? []) {
    const domain = shopDomainFromUrl(cand.checkout_url);
    if (domain) return { name: null, domain };
  }

  return { name: null, domain: null };
}

/** Normalize optional catalog fields that vary by MCP view / merchant. */
export function enrichCatalogProductDetail(
  product: CatalogProductDetail,
): CatalogProductDetail {
  const raw = product as CatalogProductDetail & Record<string, unknown>;
  const variants = (product.variants ?? []).map(normalizeCatalogVariant);

  let seller =
    parseCatalogSeller(raw.seller ?? raw.shop ?? raw.merchant ?? raw.store) ??
    variants.find((v) => v.seller)?.seller;

  if (seller && !seller.domain) {
    for (const variant of variants) {
      const domain = shopDomainFromUrl(variant.checkout_url);
      if (domain) {
        seller = { ...seller, domain };
        break;
      }
    }
  }

  const url = pickCatalogString(raw, "url", "product_url", "productUrl");

  return {
    ...product,
    brand: parseCatalogBrand(raw.brand),
    rating: parseCatalogRating(raw.rating),
    variants,
    ...(url ? { url } : {}),
    ...(seller ? { seller } : {}),
  };
}

export async function getProduct(
  accessToken: string,
  productId: string,
  selected: SelectedOption[] = [],
  options: GetProductOptions = {},
): Promise<GetProductResult> {
  const filterObj = options.filters
    ? pruneFilters(options.filters as CatalogSearchFilters)
    : {};
  const contextObj = options.context ? pruneContext(options.context) : {};
  const catalog: Record<string, unknown> = { id: productId };
  if (selected.length) catalog.selected = selected;
  if (options.preferences?.length) catalog.preferences = options.preferences;
  if (Object.keys(filterObj).length) catalog.filters = filterObj;
  if (Object.keys(contextObj).length) catalog.context = contextObj;
  if (options.view) catalog.view = options.view;

  const result = await callCatalogTool<GetProductResult>(
    accessToken,
    "get_product",
    catalog,
    {
      signal: options.signal,
      onMcpExchange: (exchange) => {
        options.onMcpExchange?.(exchange);
      },
    },
  );
  if (!result.product) {
    return result;
  }
  const product = enrichCatalogProductDetail(result.product);
  return { product };
}
