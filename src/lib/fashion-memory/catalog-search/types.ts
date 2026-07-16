import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type {
  FashionSearchPlan,
  FashionSearchPlanSlot,
} from "../search-planner/types";

/** Buyer localization + positive memory signals for catalog fan-out. */
export type FashionSearchProfile = {
  countryCode: string;
  currency: string;
  language?: string;
  /** Positive style signals only — no-gos are applied client-side later. */
  positiveSignals: string[];
};

import type { ProductNormalization } from "../normalize/types";
import type { HardDroppedProduct, ProductSuspicion } from "../hard-drops/types";
import type { ProductScore } from "../scoring/types";
import type { PipelineDebugProduct } from "@/lib/ai-chat/search/pipeline-debug";
import type { ProductCard } from "@/lib/ai-chat/types";

export type FashionQueryVariantUsed = {
  query: string;
  category_filtered: boolean;
  /** Retrieval lane — A hedge / B price scout / C precise. */
  lane?: import("./category-hedge").CatalogLane;
};

export type FashionCatalogPageCall = {
  page: number;
  /** Full `catalog` object sent to `search_catalog` for this page. */
  request: Record<string, unknown>;
  product_count: number;
  has_next_page: boolean;
};

export type FashionCatalogQueryLog = {
  slot_id: string;
  variant_index: number;
  query: string;
  reformulation: boolean;
  status: "ok" | "failed" | "timeout";
  raw_count: number;
  duration_ms: number;
  error?: string;
  /** Every `search_catalog` page request (up to 2×50 for 100 hits). */
  catalog_calls?: FashionCatalogPageCall[];
  /** Up to 100 products returned for this query variant. */
  products?: PipelineDebugProduct[];
  /** Full product cards for chat rendering. */
  product_cards?: ProductCard[];
};

/** Raw catalog hit with corroboration metadata for downstream scoring. */
export type FashionSlotCatalogProduct = {
  id: string;
  upid: string;
  matched_by: number[];
  matched_by_color_variant: boolean;
  /** True when every matching query lane omitted the category filter. */
  matched_only_unfiltered?: boolean;
  /** Lanes that returned this product (A/B/C). */
  matched_by_lanes?: import("./category-hedge").CatalogLane[];
  /** Set when a budget-lift re-admits a previously budget-dropped Lane B hit. */
  budget_lift_readmitted?: boolean;
  title: string;
  variant_options: Array<{ name: string; value: string }>;
  price?: { amount: number; currency: string };
  compare_at_price?: { amount: number; currency: string };
  rating_value?: number;
  rating_scale_max?: number;
  review_count?: number;
  merchant_id?: string;
  shop_domain?: string;
  native_checkout?: boolean;
  product_url?: string;
  image_urls: string[];
  taxonomy_category?: string;
  raw: CatalogProductSummary;
  /** Variant label normalization — populated by normalize layer. */
  normalized?: ProductNormalization;
  /** Hard-drop suspicion flags for downstream scoring. */
  suspicions?: ProductSuspicion[];
  /** Funnel score breakdown — populated by scoring layer. */
  score?: ProductScore;
  /**
   * Client-side brand verification: brand token as whole word in title,
   * merchant_id, shop_domain, or Brand/vendor catalog attribute.
   */
  brand_confirmed?: boolean;
};

export type FashionSlotCatalogResult = {
  slot_id: string;
  garment: string;
  products: FashionSlotCatalogProduct[];
  dropped?: HardDroppedProduct[];
  curator_exclusions?: string[];
  query_variants_used: FashionQueryVariantUsed[];
  counts: {
    unique_products: number;
    per_variant: number[];
    reformulated: boolean;
  };
  query_logs: FashionCatalogQueryLog[];
  /** Full Shopify payloads for debug expand view (omitted from slim metadata). */
  catalog_by_id?: Record<string, Record<string, unknown>>;
  /** Verified hydrated bench — trace lifecycle only. */
  verified_pool?: import("../hydration/types").HydratedCandidate[];
  /** Transparent unverified tail from reserve. */
  overflow_items?: import("../hydration/types").OverflowItem[];
  /** Reserve exhausted before bench target met. */
  thin_slot?: boolean;
  /**
   * Post-drop survivors < 3 — whitelist/catalog has no real inventory for
   * this family. Never fill with off-family junk; narrate honestly.
   */
  coverage_gap?: boolean;
  /** Brand probe outcome for this slot. */
  brand_status?: import("../router/types").FashionSlotBrandStatus;
  brand_sanity_note?: string;
  brand_confirmed_count?: number;
  /**
   * Price landscape of right-garment Lane B hits measured before budget drops.
   * Major currency units (same as budget allocation).
   */
  market_prices?: {
    p10: number;
    p50: number;
    p90: number;
    min_viable: number;
    sample_size: number;
  };
  /** Full product payloads for budget drops — used for zero-latency lift re-admission. */
  budget_dropped_pool?: FashionSlotCatalogProduct[];
  /** Products between enforced_max and guard_max (major-unit band). */
  guard_band_count?: number;
  /** Client hard-drop ceiling (major units). */
  enforced_max?: number;
  /** Server relevance-guard ceiling (major units). */
  guard_max?: number;
};

export type FashionCatalogSearchResult = {
  version: 1;
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  timing_ms: number;
  /** User-facing brand outcome line when brand_direction was stated. */
  brand_narration?: string;
  budget_assembly?: import("../budget/budgetAllocation").BudgetAssembly;
  budget_interpretation?: import("../budget/budgetAllocation").BudgetInterpretation;
  budget_tension?: import("../budget/budgetTension").BudgetTension;
  curation?: import("../curation/types").FashionCurationPresentation;
  curation_ms?: number;
  curation_debug?: import("../curation/fashion-curation-debug").FashionCurationDebugV1;
  /** Stop before hydrate/curation — ask user to raise budget. */
  budget_raise_ask?: import("../budget/budget-raise-ask").BudgetRaiseAsk;
};

/** Chat/admin metadata — scored catalog + query logs omitted (see agent debug). */
export type MessageFashionCatalogSearchMetaV1 = {
  version: 1;
  slots: Array<
    Pick<
      FashionSlotCatalogResult,
      | "slot_id"
      | "garment"
      | "dropped"
      | "curator_exclusions"
      | "query_variants_used"
      | "counts"
      | "verified_pool"
      | "overflow_items"
      | "thin_slot"
      | "brand_status"
      | "brand_sanity_note"
      | "brand_confirmed_count"
      | "market_prices"
      | "guard_band_count"
      | "enforced_max"
      | "guard_max"
    > & {
      /** Legacy runs may still carry full scored survivors — chat UI ignores these. */
      products?: FashionSlotCatalogResult["products"];
      query_logs?: FashionSlotCatalogResult["query_logs"];
    }
  >;
  timing_ms: number;
  brand_narration?: string;
  trace_id?: string;
  budget_assembly?: import("../budget/budgetAllocation").BudgetAssembly;
  budget_interpretation?: import("../budget/budgetAllocation").BudgetInterpretation;
  budget_tension?: import("../budget/budgetTension").BudgetTension;
  curation?: import("../curation/types").MessageFashionCurationMetaV1;
  /** Frozen UI contract with try-on availability — preferred chat render surface. */
  render?: import("../types/render-contract").RenderContract;
};

import type { AbortScope } from "@/lib/ai-chat/abort-scope";

export type SearchCatalogForSlotParams = {
  slot: FashionSearchPlanSlot;
  brief: FashionSearchBrief;
  profile: FashionSearchProfile;
  accessToken: string;
  signal?: AbortSignal;
  abortScope?: AbortScope;
  traceId?: string | null;
  mode?: import("../search-planner/types").SearchPlanMode;
  allocation?: import("../budget/budgetAllocation").ResolvedBudgetAllocation | null;
  liftedMax?: number;
  /** When true, skip descriptor reformulation (budget-lift retry). */
  liftRetryOnly?: boolean;
  /** Fired as each query variant returns — stream thumbnails into the chat loader. */
  onVariantHit?: (hit: {
    products: import("@/lib/shopify/catalog").CatalogProductSummary[];
    slotId: string;
    garment: string;
  }) => void;
};

export type FashionCatalogPlanPhase = {
  /** When omitted, UI only updates image pools (no new narration line). */
  line?: string;
  /** Surviving / found product thumbnails for the loader rack. */
  previewImages?: string[];
  /** Hard-dropped product thumbnails for the discard strip. */
  droppedImages?: string[];
};

export type SearchFashionCatalogPlanParams = {
  plan: FashionSearchPlan;
  profile: FashionSearchProfile;
  accessToken: string;
  recipientFacts?: import("../types").FashionFactRow[];
  signal?: AbortSignal;
  traceId?: string | null;
  tasteSignals?: Array<{
    attribute_type: string;
    attribute_value: string;
    polarity: number;
  }>;
  recipientRelation?: string;
  /** Prebuilt recipient profile block for curation (facts + signals). */
  recipientProfile?: string;
  excludedRefs?: string[];
  /** Guest memory snapshot — used to rebuild recipient profile when not passed. */
  guestSnapshot?: import("../local/store").GuestFashionMemorySnapshot;
  /** When set, persist slot pools to search_pools after hydration (messageId as search_id). */
  searchId?: string;
  userId?: string;
  /** Live progress for chat UI — per-slot catalog hits and phase narration. */
  onPhase?: (phase: FashionCatalogPlanPhase) => void;
  /** E2E/test — mock LLM stages (brand translate, curation). */
  createMessage?: typeof import("../observability/traced-llm-call").tracedLLMCall;
  /** E2E/test — ref-aligned curation without static LLM recording. */
  resolveCurationMessage?: import("../curation/types").RunFashionCurationParams["resolveCurationMessage"];
  /** Use ref-aligned curation (E2E default when true). */
  ref_aligned_curation?: boolean;
  /** Skip budget-raise gate (user chose continue-anyway / declined budget gap). */
  skipBudgetRaiseAsk?: boolean;
};
