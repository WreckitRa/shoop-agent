import { safeTrim } from "../safe-trim";
import type { FashionRouterContext, FashionSearchBrief } from "../router/types";
import type { FashionPendingBriefMetaV1 } from "../router/types";
import { fashionSearchBriefSchema } from "../router/tool-schema";

function lastUserMessage(
  messages: FashionRouterContext["conversationMessages"],
): string {
  return (
    [...messages].reverse().find((m) => m.role === "user")?.content?.trim() ??
    ""
  );
}

function inferRecipient(
  context: FashionRouterContext,
  pendingBrief?: FashionPendingBriefMetaV1 | null,
): string {
  if (pendingBrief?.brief.recipient_person_id) {
    return pendingBrief.brief.recipient_person_id;
  }
  return (
    Object.entries(context.personShortIds).find(([, id]) => id)?.[0] ?? "self"
  );
}

/**
 * Last-resort brief when the router cannot parse — ONLY from a parked
 * pending brief the LLM already authored. Never invent request_type /
 * occasion / garments from keyword scans of free text.
 */
export function buildFallbackBriefFromContext(params: {
  context: FashionRouterContext;
  pendingBrief?: FashionPendingBriefMetaV1 | null;
  reason: string;
}): { brief: FashionSearchBrief; inputs: Record<string, unknown> } | null {
  const pending = params.pendingBrief?.brief;
  if (!pending?.garments?.length) {
    return null;
  }

  const lastUser = lastUserMessage(params.context.conversationMessages);
  const styleDirection =
    safeTrim(pending.style_direction) ||
    lastUser.slice(0, 200) ||
    "something to wear";

  const brief = fashionSearchBriefSchema.parse({
    recipient_person_id: inferRecipient(params.context, params.pendingBrief),
    request_type: pending.request_type,
    garments: pending.garments,
    occasion_context: pending.occasion_context || "general",
    quantity_hint: pending.quantity_hint || "one",
    must_haves: pending.must_haves ?? [],
    nice_to_haves: pending.nice_to_haves ?? [],
    budget_context: pending.budget_context ?? { stated: false },
    style_direction: styleDirection,
    department_scope: pending.department_scope,
    color_direction: pending.color_direction,
    brand_direction: pending.brand_direction,
    stated_facts: pending.stated_facts,
  });

  return {
    brief,
    inputs: {
      reason: params.reason,
      pending_brief: pending,
      last_user_message: lastUser,
      source: "pending_brief_only",
    },
  };
}
