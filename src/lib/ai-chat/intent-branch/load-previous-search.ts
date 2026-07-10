import { prisma } from "../db";
import type { MessageMetadata } from "../types";
import {
  searchMissionFromInvocation,
  type SearchMissionSnapshot,
} from "./search-mission";

/** Last successful catalog search on this branch before the current user turn. */
export async function loadPreviousSearchMission(params: {
  conversationId: string;
  branchId: string;
  beforeUserMessageId: string;
}): Promise<SearchMissionSnapshot | null> {
  const userRow = await prisma.message.findUnique({
    where: { id: params.beforeUserMessageId },
    select: { createdAt: true },
  });
  if (!userRow) return null;

  const priorAssistant = await prisma.message.findFirst({
    where: {
      conversationId: params.conversationId,
      branchId: params.branchId,
      role: "assistant",
      status: "completed",
      createdAt: { lt: userRow.createdAt },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { metadata: true },
  });
  if (!priorAssistant?.metadata) return null;

  const searches = (priorAssistant.metadata as MessageMetadata).productSearch
    ?.searches;
  if (!searches?.length) return null;

  for (let i = searches.length - 1; i >= 0; i--) {
    const inv = searches[i]!;
    if (inv.error) continue;
    if (!inv.products?.length) continue;
    return searchMissionFromInvocation(inv);
  }

  return null;
}
