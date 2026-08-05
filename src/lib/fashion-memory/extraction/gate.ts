import type { MessageMetadata } from "@/lib/ai-chat/types";

export type FashionGateMessage = {
  id: string;
  role: string;
  content: string;
  metadata?: MessageMetadata | null;
};

const ACK_PATTERN =
  /^(yes|no|ok|okay|sure|thanks|the (first|second|third)( one)?|show me more|next)\b/i;

export function isShortAckMessage(text: string): boolean {
  const t = text.trim();
  if (t.length < 15) return true;
  return ACK_PATTERN.test(t);
}

/** Assistant was asking for information — short answers must still be extracted. */
export function assistantWasSoliciting(message: FashionGateMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.content.includes("?")) return true;
  if (message.metadata?.fashionRouter?.move === "ask_clarification") return true;
  return false;
}

export function findPrecedingAssistant(
  orderedMessages: FashionGateMessage[],
  userMessageId: string,
): FashionGateMessage | null {
  const idx = orderedMessages.findIndex((m) => m.id === userMessageId);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    if (orderedMessages[i]!.role === "assistant") {
      return orderedMessages[i]!;
    }
  }
  return null;
}

export type FashionExtractionGateDecision =
  | { proceed: true }
  | { proceed: false; reason: "no_new_user_messages" | "short_ack_no_solicitation" };

/**
 * Cost gate — may defer extraction but must never drop data (watermark stays put).
 */
export function evaluateFashionExtractionGate(params: {
  newUserMessages: FashionGateMessage[];
  orderedMessages: FashionGateMessage[];
}): FashionExtractionGateDecision {
  if (!params.newUserMessages.length) {
    return { proceed: false, reason: "no_new_user_messages" };
  }

  const newestUser = params.newUserMessages[params.newUserMessages.length - 1]!;
  if (!isShortAckMessage(newestUser.content)) {
    return { proceed: true };
  }

  const preceding = findPrecedingAssistant(
    params.orderedMessages,
    newestUser.id,
  );
  if (preceding && assistantWasSoliciting(preceding)) {
    return { proceed: true };
  }

  return { proceed: false, reason: "short_ack_no_solicitation" };
}
