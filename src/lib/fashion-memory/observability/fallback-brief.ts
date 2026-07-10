import { safeTrim } from "../safe-trim";
import type { FashionRouterContext, FashionSearchBrief } from "../router/types";
import type { FashionPendingBriefMetaV1 } from "../router/types";
import { fashionSearchBriefSchema } from "../router/tool-schema";

const OUTFIT_RE = /\b(outfit|look|head to toe|head-to-toe)\b/i;
const CAPSULE_RE = /\b(rotation|switch between|capsule|few outfits)\b/i;
const WEDDING_RE = /\bwedding\b/i;
const WORK_RE = /\b(work|office|consultant)\b/i;
const FUNERAL_RE = /\bfuneral\b/i;
const INTERVIEW_RE = /\binterview\b/i;
const PARTY_RE = /\bparty\b/i;

/** Single-item garment cues, most-specific first. */
const GARMENT_CUE_PATTERNS: Array<{ garment: string; re: RegExp }> = [
  {
    garment: "dress",
    re: /\b(dress|dresses|gown|gowns)\b/i,
  },
  {
    garment: "skirt",
    re: /\b(skirt|skirts)\b/i,
  },
  {
    garment: "jumpsuit",
    re: /\b(jumpsuit|jumpsuits)\b/i,
  },
  {
    garment: "blazer",
    re: /\b(blazer|blazers)\b/i,
  },
  {
    garment: "jacket",
    re: /\b(jacket|jackets|coat|coats)\b/i,
  },
  {
    garment: "shoes",
    re: /\b(shoe|shoes|sneaker|sneakers|boot|boots|heel|heels|loafer|loafers|sandal|sandals)\b/i,
  },
  {
    garment: "trousers",
    re: /\b(pant|pants|trouser|trousers|chino|chinos|jean|jeans)\b/i,
  },
  {
    garment: "shirt",
    re: /\b(shirt|shirts|blouse|tee|t-shirt|tshirt|top|tops|sweater|polo)\b/i,
  },
];

function lastUserMessage(
  messages: FashionRouterContext["conversationMessages"],
): string {
  return (
    [...messages].reverse().find((m) => m.role === "user")?.content?.trim() ??
    ""
  );
}

function inferRequestType(
  messages: FashionRouterContext["conversationMessages"],
): FashionSearchBrief["request_type"] {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== "user") continue;
    if (CAPSULE_RE.test(msg.content)) return "capsule";
    if (OUTFIT_RE.test(msg.content)) return "outfit";
  }
  return "single_item";
}

function inferOccasion(
  messages: FashionRouterContext["conversationMessages"],
  pendingBrief?: FashionPendingBriefMetaV1 | null,
): string {
  if (pendingBrief?.brief.occasion_context && pendingBrief.brief.occasion_context !== "general") {
    return pendingBrief.brief.occasion_context;
  }
  const joined = messages.map((m) => m.content).join("\n");
  if (WEDDING_RE.test(joined)) return "wedding_guest";
  if (FUNERAL_RE.test(joined)) return "funeral";
  if (INTERVIEW_RE.test(joined)) return "interview";
  if (PARTY_RE.test(joined)) return "party";
  if (WORK_RE.test(joined)) return "work";
  if (/\bformal\b/i.test(joined)) return "formal";
  return "general";
}

/** Pull concrete garment types from free text (dress, blazer, …). */
export function inferGarmentsFromText(text: string): string[] {
  const found: string[] = [];
  for (const { garment, re } of GARMENT_CUE_PATTERNS) {
    if (re.test(text) && !found.includes(garment)) found.push(garment);
  }
  return found;
}

function inferGarments(
  messages: FashionRouterContext["conversationMessages"],
  requestType: FashionSearchBrief["request_type"],
  pendingBrief?: FashionPendingBriefMetaV1 | null,
): string[] {
  if (pendingBrief?.brief.garments?.length) {
    return pendingBrief.brief.garments;
  }
  const joined = messages.map((m) => m.content).join("\n");
  const fromText = inferGarmentsFromText(joined);
  if (fromText.length) {
    if (requestType === "outfit" || requestType === "capsule") {
      // Keep named pieces; fill head-to-toe only when nothing specific was said.
      return fromText;
    }
    return fromText;
  }
  if (requestType === "outfit" || requestType === "capsule") {
    if (WEDDING_RE.test(joined)) {
      return ["shirt", "trousers", "shoes"];
    }
    return ["top", "bottom", "shoes"];
  }
  return ["top"];
}

function inferRecipient(
  context: FashionRouterContext,
  pendingBrief?: FashionPendingBriefMetaV1 | null,
): string {
  if (pendingBrief?.brief.recipient_person_id) {
    return pendingBrief.brief.recipient_person_id;
  }
  const selfRef =
    Object.entries(context.personShortIds).find(([, id]) => id)?.[0] ?? "self";
  return selfRef;
}

/**
 * Build a forced ready_to_search brief from conversation + pending brief state.
 * Used when clarification cap exhausts router retries.
 */
export function buildFallbackBriefFromContext(params: {
  context: FashionRouterContext;
  pendingBrief?: FashionPendingBriefMetaV1 | null;
  reason: string;
}): { brief: FashionSearchBrief; inputs: Record<string, unknown> } {
  const requestType = params.pendingBrief?.brief.request_type ??
    inferRequestType(params.context.conversationMessages);
  const occasion = inferOccasion(
    params.context.conversationMessages,
    params.pendingBrief,
  );
  const garments = inferGarments(
    params.context.conversationMessages,
    requestType,
    params.pendingBrief,
  );
  const lastUser = lastUserMessage(params.context.conversationMessages);
  const styleDirection =
    safeTrim(params.pendingBrief?.brief.style_direction) ||
    lastUser.slice(0, 200) ||
    "something to wear";

  const brief = fashionSearchBriefSchema.parse({
    recipient_person_id: inferRecipient(params.context, params.pendingBrief),
    request_type: requestType,
    garments,
    occasion_context: occasion,
    quantity_hint:
      params.pendingBrief?.brief.quantity_hint ??
      (requestType === "capsule" ? "three" : "one"),
    must_haves: params.pendingBrief?.brief.must_haves ?? [],
    nice_to_haves: params.pendingBrief?.brief.nice_to_haves ?? [],
    budget_context: params.pendingBrief?.brief.budget_context ?? {
      stated: false,
    },
    style_direction: styleDirection,
    department_scope: params.pendingBrief?.brief.department_scope,
  });

  return {
    brief,
    inputs: {
      reason: params.reason,
      pending_brief: params.pendingBrief?.brief ?? null,
      inferred_request_type: requestType,
      inferred_occasion: occasion,
      last_user_message: lastUser,
    },
  };
}
