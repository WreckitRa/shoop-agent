import { NEW_CHAT_TITLE } from "@/lib/ai-chat/constants";
import { userVisibleConversationWhere } from "@/lib/ai-chat/conversation-visibility";
import { prisma } from "@/lib/ai-chat/db";
import type { MessageMetadata } from "@/lib/ai-chat/types";

export type ResumeHint = {
  label: string;
  conversationId: string;
};

const PREFIX_RE =
  /^(find me|help me find|looking for|search for|i need|i want|can you find|show me)\s+/i;

export function formatResumeLabel(raw: string): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  text = text.replace(PREFIX_RE, "").replace(/[?.!]+$/, "").trim();
  if (text.length < 3) return null;
  if (text.length > 56) text = `${text.slice(0, 53).trim()}…`;

  return text.toLowerCase();
}

function queryFromMessages(
  messages: { role: string; content: string; metadata: unknown }[],
): string | null {
  for (const message of messages) {
    const meta = message.metadata as MessageMetadata | null;
    const searches = meta?.productSearch?.searches;
    if (searches?.length) {
      const query = searches[searches.length - 1]?.query?.trim();
      if (query) return query;
    }
  }

  const lastUser = messages.find(
    (m) => m.role === "user" && m.content.trim().length > 0,
  );
  return lastUser?.content.trim() ?? null;
}

export async function getResumeHint(
  userId: string,
): Promise<ResumeHint | null> {
  const [conversation, productInteraction, intent] = await Promise.all([
    prisma.conversation.findFirst({
      where: userVisibleConversationWhere(userId),
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { role: true, content: true, metadata: true },
        },
      },
    }),
    prisma.productInteraction.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { title: true, conversationId: true },
    }),
    prisma.shoppingIntent.findFirst({
      where: { userId, status: "active" },
      orderBy: { updatedAt: "desc" },
      select: { intentName: true },
    }),
  ]);

  if (!conversation) return null;

  const fromMessages = queryFromMessages(conversation.messages);
  if (fromMessages) {
    const label = formatResumeLabel(fromMessages);
    if (label) return { label, conversationId: conversation.id };
  }

  if (conversation.title && conversation.title !== NEW_CHAT_TITLE) {
    const label = formatResumeLabel(conversation.title);
    if (label) return { label, conversationId: conversation.id };
  }

  if (productInteraction?.title) {
    const label = formatResumeLabel(productInteraction.title);
    if (label) {
      return {
        label,
        conversationId:
          productInteraction.conversationId ?? conversation.id,
      };
    }
  }

  if (intent?.intentName) {
    const label = formatResumeLabel(intent.intentName);
    if (label) return { label, conversationId: conversation.id };
  }

  return null;
}
