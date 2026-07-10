import { requestAttributesFromQuery } from "./request-attributes";
import type { RequestEventAttributes } from "./types";

/** Deterministic request-event payload for guest SSE (no LLM). */
export function buildFashionGuestRequestEventPayload(params: {
  conversationId: string;
  query: string;
}): {
  version: 1;
  conversationId: string;
  query: string;
  attributes: RequestEventAttributes;
} {
  return {
    version: 1,
    conversationId: params.conversationId,
    query: params.query,
    attributes: requestAttributesFromQuery(params.query),
  };
}
