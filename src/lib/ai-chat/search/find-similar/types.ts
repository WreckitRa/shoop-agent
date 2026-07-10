import type { CuratedPick } from "../../types";

/** One contrastive attribute inferred from seed vs sibling picks. */
export type TasteDifferentiator = {
  attribute: string;
  weight: number;
  confidence: number;
};

export type TasteEvidenceKind =
  | "similar_tap"
  | "chip_confirm"
  | "rejection"
  | "intersection"
  | "decay";

export type TasteEvidence = {
  at: string;
  kind: TasteEvidenceKind;
  seedProductId: string;
  sourceMessageId?: string;
  detail?: string;
};

/** Session-scoped taste hypothesis — strengthened by repeated taps. */
export type TasteHypothesis = {
  version: 1;
  differentiators: TasteDifferentiator[];
  sharedContext: string[];
  uncertain: TasteDifferentiator[];
  nonSignals: string[];
  updatedAt: string;
  evidence: TasteEvidence[];
};

export type FindSimilarSeed = {
  productId: string;
  productTitle: string;
  upid?: string;
};

export const MAX_FIND_SIMILAR_SEEDS = 3;

export type FindSimilarPayload = {
  sourceMessageId: string;
  /** Preferred — one or more seeds (max 3). */
  seeds?: FindSimilarSeed[];
  /** Legacy single-seed fields (taste-probe re-runs). */
  productId?: string;
  productTitle?: string;
  upid?: string;
  /** When set, user picked an attribute chip to confirm. */
  confirmedAttribute?: string;
};

export function normalizeFindSimilarSeeds(
  payload: FindSimilarPayload,
): FindSimilarSeed[] {
  if (payload.seeds?.length) {
    return payload.seeds.slice(0, MAX_FIND_SIMILAR_SEEDS);
  }
  if (payload.productId?.trim() && payload.productTitle?.trim()) {
    return [
      {
        productId: payload.productId.trim(),
        productTitle: payload.productTitle.trim(),
        upid: payload.upid,
      },
    ];
  }
  return [];
}

export type SimilarSearchContext = {
  seedProductId: string;
  seedTitle: string;
  seedUpid?: string;
  seedImageUrl?: string;
  seedPriceCents: number | null;
  seedDescription?: string;
  seedOptions?: CuratedPick["options"];
  seedVendor?: string;
  siblingPicks: CuratedPick[];
  sourceMessageId: string;
  hypothesis: TasteHypothesis | null;
  /** True when user immediately re-tapped same seed (bounce). */
  bouncedSameSeed?: boolean;
};

export const SIMILAR_CONFIDENCE_ELICIT_THRESHOLD = 0.42;
export const SIMILAR_VALIDATION_EVIDENCE_MIN = 2;
export const SIMILAR_VALIDATION_CONFIDENCE_MIN = 0.55;

export const SIMILAR_ATTRIBUTE_CHIPS = [
  { id: "material", label: "Material" },
  { id: "color", label: "Color" },
  { id: "shape", label: "Shape" },
  { id: "just_similar", label: "Just similar" },
] as const;
