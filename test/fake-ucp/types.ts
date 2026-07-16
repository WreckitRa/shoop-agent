import type {
  CatalogProductDetail,
  CatalogProductSummary,
} from "@/lib/shopify/catalog";

/** Scripted per-step mutations for get_product (hydration death, price drift, 404). */
export type FakeUcpMutation =
  | { kind: "variant_unavailable"; productId: string; variantId?: string }
  | { kind: "price_drift"; productId: string; amount: number }
  | { kind: "not_found"; productId: string; afterStep?: number }
  | { kind: "checkout_missing"; productId: string };

export type FakeUcpCatalogConfig = {
  /** Primary relevance-ordered products returned before noise fill. */
  relevant: CatalogProductSummary[];
  /** Junk-fill pool when relevant set is smaller than limit. */
  noise?: CatalogProductSummary[];
  /** Full product detail overrides keyed by id (hydration). */
  details?: Record<string, CatalogProductDetail>;
  /** Price filter behavior — soft ignores max for junk scenarios. */
  priceFilterMode?: "honor" | "soft";
  /** Scripted mutations keyed by harness step index. */
  mutations?: FakeUcpMutation[];
};

export type FakeUcpRuntime = {
  catalog: FakeUcpCatalogConfig;
  stepIndex: number;
  getProductCalls: number;
};

export type CatalogRef = FakeUcpCatalogConfig | { ref: string };
