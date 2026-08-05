import { prisma } from "./db";

type ConversationContextSummaryDelegate = {
  deleteMany: (args: object) => Promise<unknown>;
};

function summaryDelegate(): ConversationContextSummaryDelegate | null {
  const d = (prisma as unknown as { conversationContextSummary?: unknown })
    .conversationContextSummary;
  if (!d || (typeof d !== "object" && typeof d !== "function")) return null;
  return d as ConversationContextSummaryDelegate;
}

export async function invalidateConversationContextSummary(
  conversationId: string,
) {
  const summaries = summaryDelegate();
  if (!summaries) return;
  await summaries.deleteMany({ where: { conversationId } });
}
