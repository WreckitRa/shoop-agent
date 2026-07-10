import { prisma } from "../db";
import type { ConversationBranchSummary } from "../types";
import { branchToSummary } from "./serialize";

export async function listBranchesByConversationIds(
  conversationIds: string[],
): Promise<Map<string, ConversationBranchSummary[]>> {
  const map = new Map<string, ConversationBranchSummary[]>();
  if (!conversationIds.length) return map;

  const rows = await prisma.conversationBranch.findMany({
    where: { conversationId: { in: conversationIds } },
    orderBy: [{ conversationId: "asc" }, { index: "asc" }],
  });

  for (const row of rows) {
    const list = map.get(row.conversationId) ?? [];
    list.push(branchToSummary(row));
    map.set(row.conversationId, list);
  }
  return map;
}

export async function listBranchesForConversation(
  conversationId: string,
): Promise<ConversationBranchSummary[]> {
  const rows = await prisma.conversationBranch.findMany({
    where: { conversationId },
    orderBy: { index: "asc" },
  });
  return rows.map(branchToSummary);
}

/** Branches created after `since` (for toast polling). */
export async function listIntentEventsSince(
  conversationId: string,
  since: Date,
): Promise<ConversationBranchSummary[]> {
  const rows = await prisma.conversationBranch.findMany({
    where: {
      conversationId,
      index: { gt: 0 },
      createdAt: { gt: since },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(branchToSummary);
}
