import {
  detectAccessoriesCoercion,
  latestUserText,
  unknownGarmentsInBrief,
} from "../router/garment-family";
import type { FashionRouterContext, FashionSearchBrief } from "../router/types";
import type { FashionSearchPlan } from "../search-planner/types";
import { recordPipelineEvent } from "./trace";

function warnInvariant(params: {
  traceId?: string | null;
  code: string;
  detail: Record<string, unknown>;
}): void {
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "invariant_warning",
    payload: { code: params.code, ...params.detail },
  });
}

/** Codes that surface on /flagged and can trigger router escalation. */
export type BriefInvariantTrip =
  | "accessories_coerced"
  | "unknown_garment_family"
  | "reask_after_answer";

/** Re-export: clarification reask of conversation-known facts. */
export { checkReaskAfterAnswer } from "../intake/clarification-dedup";

/**
 * Observability only — never mutate the brief. Shopping intent (outfit vs
 * single_item, occasion) is the router LLM's job, not a keyword scan.
 */
export function checkBriefInvariants(params: {
  traceId?: string | null;
  messages: FashionRouterContext["conversationMessages"];
  brief: FashionSearchBrief;
}): BriefInvariantTrip[] {
  const tripped: BriefInvariantTrip[] = [];
  const userText = latestUserText(params.messages);

  if (
    detectAccessoriesCoercion({
      userText,
      garments: params.brief.garments,
    })
  ) {
    warnInvariant({
      traceId: params.traceId,
      code: "accessories_coerced",
      detail: {
        garments: params.brief.garments,
        user_excerpt: userText.slice(0, 160),
      },
    });
    tripped.push("accessories_coerced");
  }

  const unknown = unknownGarmentsInBrief(params.brief.garments);
  if (unknown.length) {
    warnInvariant({
      traceId: params.traceId,
      code: "unknown_garment_family",
      detail: { garments: unknown },
    });
    tripped.push("unknown_garment_family");
  }

  return tripped;
}

export function checkPlanInvariants(params: {
  traceId?: string | null;
  plan: FashionSearchPlan;
  validatorFallbackSlots?: string[];
}): void {
  if (
    (params.plan.mode === "outfit" || params.plan.mode === "capsule") &&
    params.plan.slots.length === 1
  ) {
    warnInvariant({
      traceId: params.traceId,
      code: "multi_slot_mode_single_slot_plan",
      detail: { mode: params.plan.mode, slot_count: params.plan.slots.length },
    });
  }

  for (const slotId of params.validatorFallbackSlots ?? []) {
    warnInvariant({
      traceId: params.traceId,
      code: "validator_fallback_query_variants",
      detail: { slot_id: slotId },
    });
  }
}
