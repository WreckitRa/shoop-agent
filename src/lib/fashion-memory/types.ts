/**
 * Fashion memory — people, facts, and style signals for chat.
 * Documents DB row shapes and fashion_facts.value jsonb schemas.
 */

// --- people ---

export type PersonRelation =
  | "self"
  | "brother"
  | "wife"
  | "friend"
  | "colleague"
  | (string & {});

export type PersonRow = {
  id: string;
  user_id: string;
  relation: PersonRelation;
  name: string | null;
  birthday: string | null;
  notes: string | null;
  /** Set when the one-time intake turn is sent — never re-run intake after this. */
  intake_completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Active avatar payload when try-on is set up. */
  avatar?: {
    url: string;
    storage_path: string;
    attributes: Record<string, unknown>;
    created_at: string;
    version: string;
  } | null;
  avatar_source_photo_path?: string | null;
};

// --- fashion_facts.value jsonb shapes ---

export type SizeSystem = "alpha" | "eu" | "us" | "uk" | "waist_inseam";

export type WaistInseamSize = { waist: number; inseam: number };

export type BrandSizeException = { brand: string; value: string | number };

export type FashionFactSizeValue = {
  system: SizeSystem;
  value: string | number | WaistInseamSize;
  brand_exception?: BrandSizeException | null;
};

export type FashionFactFitValue = {
  fit: "slim" | "regular" | "relaxed" | "oversized";
};

export type FashionFactNoGoKind = "material" | "style" | "color" | "garment";

export type FashionFactNoGoValue = {
  kind: FashionFactNoGoKind;
  value: string;
};

export type FashionFactBudgetBandValue = {
  min: number | null;
  max: number;
  currency: string;
};

export type FashionFactBodyNoteValue = Record<string, unknown>;

export type FashionFactGenderPresentationValue = {
  presentation: "mens" | "womens" | "boys" | "girls" | "baby" | "mixed";
};

/**
 * Precise body measurements for a future size-chart fit layer.
 * Avatar image generators must never consume these — visual attrs only.
 * Reserved: no shopping pipeline consumer yet (see docs/fashion/enums.md).
 */
export type FashionFactMeasurementMetric =
  | "height"
  | "neck"
  | "chest"
  | "waist"
  | "hips"
  | "inseam";

export type FashionFactMeasurementValue = {
  metric: FashionFactMeasurementMetric;
  value: number;
  unit: "cm" | "in";
};

export type FashionFactType =
  | "size"
  | "fit"
  | "no_go"
  | "budget_band"
  | "body_note"
  | "gender_presentation"
  /** Reserved for future size-chart fit — do not consume in scoring/search yet. */
  | "measurement"
  /** Stable depth they want shown (looks or options per item). */
  | "depth_default";

export type FashionFactDepthDefaultValue = {
  count: number;
  unit: "looks" | "options";
};

export type FashionFactValueByType = {
  size: FashionFactSizeValue;
  fit: FashionFactFitValue;
  no_go: FashionFactNoGoValue;
  budget_band: FashionFactBudgetBandValue;
  body_note: FashionFactBodyNoteValue;
  gender_presentation: FashionFactGenderPresentationValue;
  measurement: FashionFactMeasurementValue;
  depth_default: FashionFactDepthDefaultValue;
};

export type FashionFactValue<T extends FashionFactType = FashionFactType> =
  FashionFactValueByType[T];

export type FashionFactStatus = "active" | "superseded";

export type FashionFactRow<T extends FashionFactType = FashionFactType> = {
  id: string;
  user_id: string;
  person_id: string;
  fact_type: T;
  garment_type: string | null;
  value: FashionFactValue<T>;
  source_quote: string | null;
  status: FashionFactStatus;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
};

// --- style_signals ---

export type StyleSignalType =
  | "color"
  | "style"
  | "brand"
  | "silhouette"
  | "aesthetic"
  | "material"
  | "pattern"
  | "garment"
  /** How they like to be served: `quick` | `guided`. */
  | "shopping_style";

export type StyleSignalSource = "stated" | "inferred" | "request" | "rejection";

export type StyleSignalStatus = "active" | "superseded" | "candidate";

export type StyleSignalRow = {
  id: string;
  user_id: string;
  person_id: string;
  context: string;
  signal_type: StyleSignalType;
  value: string;
  polarity: -1 | 1;
  source: StyleSignalSource;
  confidence: number;
  evidence_count: number;
  status: StyleSignalStatus;
  source_quote: string | null;
  value_canonical?: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

// --- request_events ---

/** Episodic search/request attributes — never promoted to signals directly. */
export type RequestEventAttributes = {
  garment?: string;
  color?: string;
  occasion?: string;
  style?: string;
  brand?: string;
  material?: string;
  pattern?: string;
  silhouette?: string;
  aesthetic?: string;
  [key: string]: string | undefined;
};

export type RequestEventRow = {
  id: string;
  user_id: string;
  person_id: string;
  conversation_id: string | null;
  attributes: RequestEventAttributes;
  created_at: string;
};

// --- extraction_runs ---

export type AmbiguousSubject = {
  description: string;
  candidate_person_refs: string[];
  evidence_quote: string;
  parked_ops?: import("./extraction/tool-schema").FashionLlmOp[];
};

export type ExtractionRunStatus = "running" | "done" | "failed";

export type ExtractionOpResult = {
  op: string;
  accepted: boolean;
  reason?: string;
  entity_id?: string;
};

export type ExtractionRunRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  last_message_id: string;
  status: ExtractionRunStatus;
  ops_applied: ExtractionOpResult[] | null;
  ambiguous_subjects: AmbiguousSubject[] | null;
  created_at: string;
  finished_at: string | null;
};
