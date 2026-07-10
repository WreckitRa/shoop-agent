import { prisma } from "@/lib/ai-chat/db";
import type { FashionSearchBrief } from "../router/types";
import type { FashionPendingBriefMetaV1 } from "../router/types";

export async function loadPendingBrief(
  conversationId: string,
): Promise<FashionPendingBriefMetaV1 | null> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 24,
    select: { metadata: true },
  });

  for (const row of rows) {
    const meta = row.metadata as {
      fashionPendingBrief?: FashionPendingBriefMetaV1;
      fashionSearchPlan?: unknown;
      fashionCatalogSearch?: unknown;
      fashionRouter?: { move?: string };
    } | null;
    if (meta?.fashionSearchPlan || meta?.fashionCatalogSearch) break;
    if (meta?.fashionRouter?.move === "ready_to_search") break;
    if (meta?.fashionPendingBrief?.version === 1) {
      return meta.fashionPendingBrief;
    }
  }
  return null;
}

export function pendingBriefMeta(
  brief: FashionSearchBrief,
  recipientPersonId: string,
): FashionPendingBriefMetaV1 {
  return {
    version: 1,
    brief,
    recipientPersonId,
    savedAt: new Date().toISOString(),
  };
}
