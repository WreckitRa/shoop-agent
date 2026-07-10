import { logAiChat } from "@/lib/ai-chat/observability";
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
  if (process.env.NODE_ENV === "development") {
    console.warn("[fashion:invariant]", params.code, params.detail);
  }
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "invariant_warning",
    payload: { code: params.code, ...params.detail },
  });
  logAiChat("warn", "fashion_invariant_warning", {
    code: params.code,
    ...params.detail,
  });
}

export function checkBriefInvariants(params: {
  traceId?: string | null;
  messages: FashionRouterContext["conversationMessages"];
  brief: FashionSearchBrief;
}): void {
  if (
    threadMentionsOutfit(params.messages) &&
    params.brief.request_type === "single_item"
  ) {
    warnInvariant({
      traceId: params.traceId,
      code: "outfit_language_single_item_brief",
      detail: {
        request_type: params.brief.request_type,
        occasion_context: params.brief.occasion_context,
      },
    });
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
  }
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
