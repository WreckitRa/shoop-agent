import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { ProductScore } from "../scoring/types";
import type {
  CatalogProductDetail,
  SelectedOption,
} from "@/lib/shopify/catalog";

export type HydrationDeathCause =
  | "size_out_of_stock"
  | "size_not_offered"
  | "gone"
  | "department_mismatch"
  | "hydration_failed"
  | "user_reject"
  | `curator_veto:${string}`;

export type HydrationDeathRecord = {
  product_id: string;
  cause: HydrationDeathCause;
  evidence: string;
  stage?: string;
};

export type SizeStatus = "confirmed" | "converted" | "unknown";

export type HydratedCandidate = FashionSlotCatalogProduct & {
  /** ISO timestamp when get_product verification completed. */
  hydrated_at?: string;
  size_status: SizeStatus;
  size_selection?: {
    merchant_label: string;
    option_name: string;
    converted_from?: string;
  };
  color_selection?: {
    merchant_label: string;
    option_name: string;
  };
  /**
   * Options actually resolved by get_product (`detail.selected`).
   * Survives metadata slim (detail is stripped) so PDP can preselect.
   */
  resolved_options?: SelectedOption[];
  /** Variant GID matching resolved_options — never the product GID. */
  selected_variant_id?: string;
  /** API timeout/error — candidate was NOT verified (legacy flag on rare shells). */
  hydration_failed?: boolean;
  /** Checkout flag only — false does NOT kill the candidate. */
  native_checkout?: boolean;
  /** Full get_product payload — trace/search lifecycle only, not a product DB. */
  detail?: CatalogProductDetail;
  media_urls: string[];
  product_url?: string;
  variant_url?: string;
  final_price?: { amount: number; currency: string };
  option_matrix?: Array<{
    name: string;
    values: Array<{ label: string; available?: boolean; exists?: boolean }>;
  }>;
  description_text?: string;
};

export type ScoredProduct = FashionSlotCatalogProduct & { score: ProductScore };

export type OverflowItem = {
  product_id: string;
  title: string;
  price?: { amount: number; currency: string };
  image_url?: string;
  merchant?: string;
  score_rank: number;
  score_final: number;
  verification: "not_verified";
  size_note?: string;
};

export type HydrationMetrics = {
  shortlisted: number;
  waves: number;
  killed: {
    size_out_of_stock: number;
    size_not_offered: number;
    gone: number;
    department_mismatch: number;
  };
  hydration_failed: number;
  size_status_counts: {
    confirmed: number;
    converted: number;
    unknown: number;
  };
  verified_final: number;
  overflow_count: number;
  thin: boolean;
  ms: number;
};

export type HydrateCandidateResult =
  | { outcome: "verified"; candidate: HydratedCandidate }
  | { outcome: "death"; death: HydrationDeathRecord };

export type SizeSelectionBuild = {
  selected: SelectedOption[];
  hadSizeSelection: boolean;
  convertedFrom?: string;
};

export type SlotPool = {
  readonly verified: HydratedCandidate[];
  readonly reserve: FashionSlotCatalogProduct[];
  readonly dead: HydrationDeathRecord[];
  readonly thin: boolean;
  readonly target: number;
  readonly options_wanted: number;
  fillToTarget(): Promise<void>;
  /** Downstream drops/swaps call this to restore the verified bench. */
  reportDeath(
    productId: string,
    cause: HydrationDeathCause,
    stage: string,
  ): Promise<void>;
  getOverflow(n?: number): OverflowItem[];
};
