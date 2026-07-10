import type { ConstraintGateMetrics } from "./constraint-gate";

export type PipelineStageMs = {
  portfolio?: number;
  pool?: number;
  score?: number;
  verify?: number;
  enrich?: number;
  slot?: number;
  total?: number;
};

export type PipelineGateMetrics = {
  constraintGate?: ConstraintGateMetrics;
  verifyAttempted?: number;
  verifySurvived?: number;
  sizeExactRequired?: boolean;
  giftMerchDropped?: number;
  shippingGuardDropped?: number;
  judgeOmissions?: number;
  judgePreGateDrops?: number;
  judgePostGateDrops?: number;
  listingHygieneDropped?: number;
};

export function mergeGateMetrics(
  base: PipelineGateMetrics,
  patch: Partial<PipelineGateMetrics>,
): PipelineGateMetrics {
  return { ...base, ...patch };
}
