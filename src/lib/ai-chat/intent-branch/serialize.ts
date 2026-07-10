import type { ConversationBranch } from "@prisma/client";
import type { ConversationBranchSummary } from "../types";

export function branchToSummary(b: ConversationBranch): ConversationBranchSummary {
  return {
    id: b.id,
    conversationId: b.conversationId,
    index: b.index,
    title: b.title,
    anchorMessageId: b.anchorMessageId ?? null,
    sourceMessageId: b.sourceMessageId,
    createdAt: b.createdAt.toISOString(),
  };
}
