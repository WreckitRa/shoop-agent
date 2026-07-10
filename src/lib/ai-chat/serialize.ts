import type { ConversationRecord, MessageRecord } from "./prisma-types";
import type {
  ChatMessage as ChatMessageDTO,
  ConversationSummary,
  ResponseStyle,
} from "./types";

export function conversationToSummary(c: ConversationRecord): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    archived: c.archived,
    pinned: c.pinned,
    model: c.model,
    responseStyle: c.responseStyle as ResponseStyle,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    systemPrompt: c.systemPrompt,
    shippingCountry: c.shippingCountry ?? null,
    currency: c.currency ?? null,
  };
}

export function messageToDTO(m: MessageRecord): ChatMessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role as ChatMessageDTO["role"],
    content: m.content,
    status: m.status as ChatMessageDTO["status"],
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    branchId: m.branchId ?? null,
    model: m.model,
    finishReason: m.finishReason,
    error: m.error,
    metadata: (m.metadata as ChatMessageDTO["metadata"] | null | undefined) ?? null,
  };
}
