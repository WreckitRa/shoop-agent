import { logAiChat } from "@/lib/ai-chat/observability";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { FashionGateMessage } from "./gate";

export type FashionTurnMessage = FashionGateMessage & {
  createdAt: Date;
};

export async function loadFashionTurnMessages(params: {
  conversationId: string;
  afterMessageId: string | null;
}): Promise<FashionTurnMessage[]> {
  const { prisma } = await import("@/lib/ai-chat/db");
  const after = params.afterMessageId
    ? await prisma.message.findUnique({
        where: { id: params.afterMessageId },
        select: { createdAt: true },
      })
    : null;

  const rows = await prisma.message.findMany({
    where: {
      conversationId: params.conversationId,
      ...(after
        ? {
            OR: [
              { createdAt: { gt: after.createdAt } },
              {
                createdAt: after.createdAt,
                id: { gt: params.afterMessageId! },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    metadata: (row.metadata ?? null) as MessageMetadata | null,
    createdAt: row.createdAt,
  }));
}

/** Last N conversation messages, oldest first (for extraction prompt window). */
export async function loadRecentFashionMessages(params: {
  conversationId: string;
  limit?: number;
}): Promise<FashionTurnMessage[]> {
  const { prisma } = await import("@/lib/ai-chat/db");
  const limit = params.limit ?? 10;
  const rows = await prisma.message.findMany({
    where: { conversationId: params.conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      role: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  return rows.reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    metadata: (row.metadata ?? null) as MessageMetadata | null,
    createdAt: row.createdAt,
  }));
}

export function partitionFashionTurnMessages(messages: FashionTurnMessage[]): {
  ordered: FashionGateMessage[];
  newUserMessages: FashionGateMessage[];
} {
  const ordered = messages.map(({ createdAt: _c, ...rest }) => rest);
  const newUserMessages = ordered.filter((m) => m.role === "user");
  return { ordered, newUserMessages };
}

export function logFashionExtractionSkip(params: {
  userId: string;
  conversationId: string;
  reason: string;
  sweep?: boolean;
}) {
  logAiChat("info", "fashion_extraction_skipped", {
    userId: params.userId,
    conversationId: params.conversationId,
    reason: params.reason,
    sweep: params.sweep ?? false,
  });
}

export function logFashionExtractionFailed(params: {
  userId: string;
  conversationId: string;
  error: unknown;
  sweep?: boolean;
}) {
  logAiChat("error", "fashion_extraction_failed", {
    userId: params.userId,
    conversationId: params.conversationId,
    sweep: params.sweep ?? false,
    error: params.error,
  });
}
