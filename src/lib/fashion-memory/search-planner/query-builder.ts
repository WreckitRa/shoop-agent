import type { FashionSearchPlan, FashionSearchPlanSlot } from "./types";
import { recordPipelineEvent } from "../observability/trace";
import {
  allowedColorWordsFromBrief,
  buildDeterministicQueryVariants,
} from "./deterministic-builder";
import { allowedColorWordsForSlot } from "./palette-ladder";
import {
  MAX_QUERY_VARIANTS,
  MIN_QUERY_VARIANTS,
} from "./query-rules";
import { validateSlotQueryVariants } from "./validator";

export type RepairSlotResult = {
  slot: FashionSearchPlanSlot;
  usedDeterministicFallback: boolean;
  validationReasons: string[];
};

/**
 * Validate planner query_variants for one slot; fall back deterministically
 * after two failed validation passes.
 */
export function repairSlotQueryVariants(
  slot: FashionSearchPlanSlot,
  plan: FashionSearchPlan,
  opts?: { traceId?: string | null },
): RepairSlotResult {
  const allowedColors = allowedColorWordsForSlot(slot, plan.brief);
  const styleDirection = slot.style_direction || plan.brief.style_direction;
  const allReasons: string[] = [];
  let usedDeterministicFallback = false;

  const department =
    plan.brief.knowledge_state?.department ?? plan.brief.department_scope;

  let validation = validateSlotQueryVariants({
    variants: slot.query_variants,
    garment: slot.garment,
    paletteSource: slot.palette_source,
    allowedColorWords: allowedColors,
    department,
  });
  allReasons.push(...validation.reasons);

  if (validation.shapeRejected?.length) {
    recordPipelineEvent({
      traceId: opts?.traceId,
      stage: "validator",
      payload: {
        kind: "variant_shape_rejected",
        slot_id: slot.slot_id,
        garment: slot.garment,
        rejected: validation.shapeRejected,
        reasons: validation.reasons.filter((r) =>
          r.startsWith("variant_shape_rejected"),
        ),
      },
    });
  }

  if (!validation.ok) {
    usedDeterministicFallback = true;
    validation = validateSlotQueryVariants({
      variants: buildDeterministicQueryVariants({
        garment: slot.garment,
        styleDirection,
        mustHaves: plan.brief.must_haves,
        includeColor:
          slot.palette_source === "stated" && allowedColors.length > 0,
        department,
      }),
      garment: slot.garment,
      paletteSource: slot.palette_source,
      allowedColorWords: allowedColors,
      department,
    });
    allReasons.push(...validation.reasons);
  }

  if (!validation.ok) {
    usedDeterministicFallback = true;
    validation = validateSlotQueryVariants({
      variants: buildDeterministicQueryVariants({
        garment: slot.garment,
        styleDirection: plan.brief.style_direction,
        mustHaves: [],
        includeColor: false,
        department,
      }),
      garment: slot.garment,
      paletteSource: slot.palette_source,
      allowedColorWords: allowedColors,
      department,
    });
    allReasons.push(...validation.reasons);
  }

  if (allReasons.length > 0) {
    recordPipelineEvent({
      traceId: opts?.traceId,
      stage: "validator",
      payload: {
        slot_id: slot.slot_id,
        rejected: slot.query_variants,
        reasons: allReasons,
        used_deterministic_fallback: usedDeterministicFallback,
      },
    });
  }

  let variants = validation.variants;
  if (variants.length < MIN_QUERY_VARIANTS) {
    const extras = buildDeterministicQueryVariants({
      garment: slot.garment,
      styleDirection,
      mustHaves: plan.brief.must_haves,
      includeColor: false,
      department,
    });
    for (const extra of extras) {
      if (variants.length >= MIN_QUERY_VARIANTS) break;
      const merged = validateSlotQueryVariants({
        variants: [...variants, extra],
        garment: slot.garment,
        paletteSource: slot.palette_source,
        allowedColorWords: allowedColors,
        department,
      });
      if (merged.variants.length > variants.length) {
        variants = merged.variants;
      }
    }
  }

  return {
    slot: {
      ...slot,
      query_variants: variants.slice(0, MAX_QUERY_VARIANTS),
    },
    usedDeterministicFallback,
    validationReasons: allReasons,
  };
}

export {
  validateSlotQueryVariants,
  tokenOverlapRatio,
  stripBannedTokens,
  containsBannedToken,
} from "./validator";
export {
  buildDeterministicQueryVariants,
  extractStyleDescriptors,
  allowedColorWordsFromBrief,
} from "./deterministic-builder";
