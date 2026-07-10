import type { FashionSlotCatalogProduct } from "../catalog-search/types";

export type HardDropRule =
  | "unavailable"
  | "budget"
  | "department_mismatch"
  | "category_mismatch"
  | "item_type_mismatch"
  | "size_mismatch"
  | "color_no_go"
  | "garment_no_go"
  | "material_no_go"
  | "drop_check_error";

export type HardDroppedProduct = {
  product_id: string;
  rule: HardDropRule;
  evidence: string;
};

export type SuspicionRule =
  | "no_price"
  | "size_system_unverified"
  | "size_unknown"
  | "color_two_tone"
  | "pattern_suspected"
  | "department_unknown"
  | "attire_conflict_title"
  | "drop_check_error"
  | "price_outlier_low"
  | `material_suspected:${string}`;

export type ProductSuspicion = {
  rule: SuspicionRule;
  evidence: string;
  source_field?: string;
};

export type SurvivorProduct = FashionSlotCatalogProduct & {
  suspicions: ProductSuspicion[];
};

export type HardDropSlotResult = {
  survivors: SurvivorProduct[];
  dropped: HardDroppedProduct[];
  curator_exclusions: string[];
  /** Lane B right-garment price landscape measured before budget drops. */
  market_prices?: {
    p10: number;
    p50: number;
    p90: number;
    min_viable: number;
    sample_size: number;
  };
  /** Budget-dropped products retained for zero-latency lift re-admission. */
  budget_dropped_pool: FashionSlotCatalogProduct[];
  /**
   * Products retrieved between enforced_max and guard_max (major-unit band).
   * These are budget-dropped but available for lift-readmission without re-query.
   */
  guard_band_count?: number;
};

export type HardDropMetrics = {
  in: number;
  out: number;
  drops_by_rule: Partial<Record<HardDropRule, number>>;
  suspicions_by_rule: Record<string, number>;
  ms: number;
};
