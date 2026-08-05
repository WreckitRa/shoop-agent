import {
  detectAccessoriesCoercion,
  latestUserText,
  unknownGarmentsInBrief,
} from "../router/garment-family";
import type { FashionRouterContext, FashionSearchBrief } from "../router/types";
import type { FashionSearchPlan } from "../search-planner/types";
import { recordPipelineEvent } from "./trace";

const OUTFIT_LANGUAGE =
  /\b(outfit|look|head to toe|head-to-toe|full outfit)\b/i;
const OCCASION_LANGUAGE =
  /\b(wedding|funeral|interview|party|work|office)\b/i;

function threadMentionsOutfit(
  messages: FashionRouterContext["conversationMessages"],
): boolean {
  return messages.some(
    (m) => m.role === "user" && OUTFIT_LANGUAGE.test(m.content),
  );
}

function threadMentionsOccasion(
  messages: FashionRouterContext["conversationMessages"],
): boolean {
  return messages.some(
    (m) => m.role === "user" && OCCASION_LANGUAGE.test(m.content),
  );
}

function briefReflectsOccasion(brief: FashionSearchBrief): boolean {
  const ctx = brief.occasion_context.toLowerCase();
  if (ctx === "general" || !ctx) return false;
  return true;
}

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
  | "outfit_language_single_item_brief"
  | "outfit_language_multi_item_brief"
  | "occasion_language_missing_from_brief"
  | "reask_after_answer";

/** Re-export: clarification reask of conversation-known facts. */
export { checkReaskAfterAnswer } from "../intake/clarification-dedup";

/**
 * When the user said "outfit" / "look" / "head to toe" but the router
 * classified as single_item or multi_item, upgrade to outfit so planning +
 * curation deliver THREE LOOKS instead of a flat rack.
 */
export function coerceBriefRequestTypeForOutfitLanguage(params: {
  traceId?: string | null;
  messages: FashionRouterContext["conversationMessages"];
  brief: FashionSearchBrief;
}): FashionSearchBrief {
  if (!threadMentionsOutfit(params.messages)) return params.brief;
  if (
    params.brief.request_type === "outfit" ||
    params.brief.request_type === "capsule"
  ) {
    return params.brief;
  }

  const from = params.brief.request_type;
  warnInvariant({
    traceId: params.traceId,
    code:
      from === "multi_item"
        ? "outfit_language_multi_item_brief"
        : "outfit_language_single_item_brief",
    detail: {
      request_type: from,
      coerced_to: "outfit",
      occasion_context: params.brief.occasion_context,
    },
  });

  return { ...params.brief, request_type: "outfit" };
}

export function checkBriefInvariants(params: {
  traceId?: string | null;
  messages: FashionRouterContext["conversationMessages"];
  brief: FashionSearchBrief;
}): BriefInvariantTrip[] {
  const tripped: BriefInvariantTrip[] = [];
  const userText = latestUserText(params.messages);

  if (
    threadMentionsOutfit(params.messages) &&
    (params.brief.request_type === "single_item" ||
      params.brief.request_type === "multi_item")
  ) {
    const code =
      params.brief.request_type === "multi_item"
        ? "outfit_language_multi_item_brief"
        : "outfit_language_single_item_brief";
    warnInvariant({
      traceId: params.traceId,
      code,
      detail: {
        request_type: params.brief.request_type,
        occasion_context: params.brief.occasion_context,
      },
    });
    tripped.push(code);
  }

  if (
    threadMentionsOccasion(params.messages) &&
    !briefReflectsOccasion(params.brief)
  ) {
    warnInvariant({
      traceId: params.traceId,
      code: "occasion_language_missing_from_brief",
      detail: {
        occasion_context: params.brief.occasion_context,
      },
    });
    tripped.push("occasion_language_missing_from_brief");
  }

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
