import { prisma } from "@/lib/ai-chat/db";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlan, MessageFashionSearchPlanMetaV1 } from "../search-planner/types";
import type { MessageFashionCatalogSearchMetaV1 } from "../catalog-search/types";

export type LastOnScreenSearch = {
  searchId: string;
  brief: FashionSearchBrief;
  plan: FashionSearchPlan;
};

/** Last completed catalog search in this conversation (skips provisional). */
export async function loadLastOnScreenSearch(
  conversationId: string,
): Promise<LastOnScreenSearch | null> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 24,
    select: { id: true, metadata: true },
  });

  for (const row of rows) {
    const meta = row.metadata as {
      fashionSearchPlan?: MessageFashionSearchPlanMetaV1;
      fashionCatalogSearch?: MessageFashionCatalogSearchMetaV1;
    } | null;
    const planMeta = meta?.fashionSearchPlan;
    const catalog = meta?.fashionCatalogSearch;
    if (!planMeta || !catalog?.brief) continue;
    if (catalog.provisional) continue;
    return {
      searchId: row.id,
      brief: catalog.brief,
      plan: {
        version: 1,
        mode: planMeta.mode,
        slots: planMeta.slots,
        reasoning: planMeta.reasoning,
        brief: catalog.brief,
        currentDate:
          catalog.plan_current_date ??
          new Date().toISOString().slice(0, 10),
        plan_source: planMeta.plan_source,
      },
    };
  }
  return null;
}
