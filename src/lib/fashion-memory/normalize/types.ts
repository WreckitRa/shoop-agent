/** Fixed canonical color buckets — single source of truth. */
export const COLOR_BUCKETS = [
  "black",
  "white",
  "grey",
  "beige",
  "brown",
  "navy",
  "blue",
  "green",
  "olive",
  "red",
  "burgundy",
  "pink",
  "purple",
  "orange",
  "yellow",
  "gold",
  "silver",
  "denim",
  "multi",
  "print",
  "unknown",
] as const;

export type ColorBucket = (typeof COLOR_BUCKETS)[number];

export type AlphaSize =
  | "XXS"
  | "XS"
  | "S"
  | "M"
  | "L"
  | "XL"
  | "XXL"
  | "XXXL";

export type NumericSizeSystem = "eu" | "us" | "uk" | "waist" | "ambiguous";

export type FitModifier =
  | "slim"
  | "regular"
  | "relaxed"
  | "oversized"
  | "petite"
  | "tall";

export type NormalizedSize = {
  alpha?: AlphaSize;
  numeric?: number;
  numeric_system?: NumericSizeSystem;
  inseam?: number;
  fit_modifier?: FitModifier;
  one_size?: boolean;
};

export type SizeCategory =
  | "tops"
  | "bottoms"
  | "shoes"
  | "dresses"
  | "outerwear"
  | "general";

export type ColorResolution = {
  buckets: ColorBucket[];
  resolved: boolean;
  via?: "cache" | "deterministic" | "fuzzy" | "llm";
};

export type SizeResolution = {
  size: NormalizedSize;
  resolved: boolean;
  via?: "cache" | "deterministic" | "fuzzy" | "llm";
};

export type NormalizedColorField = {
  buckets: ColorBucket[];
  status: "resolved" | "unknown";
};

export type NormalizedSizeField = {
  raw: string;
  size: NormalizedSize | null;
  status: "resolved" | "unknown";
};

export type ProductNormalization = {
  colors: NormalizedColorField;
  sizes: NormalizedSizeField[];
};

export type NormalizeMetrics = {
  labels_total: number;
  cache_hits: number;
  deterministic_hits: number;
  fuzzy_hits: number;
  llm_resolved: number;
  llm_unknown: number;
  ms: number;
};

export type SlotNormalizeInput = {
  slot_id: string;
  garment: string;
  products: Array<{
    variant_options: Array<{ name: string; value: string }>;
    normalized?: ProductNormalization;
  }>;
};
