import { prisma } from "@/lib/ai-chat/db";

export type QaResetSummary = Record<string, number>;

const PRESERVED_GLOBAL_TABLES = [
  "color_label_map",
  "size_label_map",
  "brand_translations",
  "shop_departments",
  "prompt_versions",
  "capability_checks",
] as const;

/**
 * FK-safe per-user wipe for manual QA sessions. Idempotent — safe to run repeatedly.
 * Does NOT touch global shared caches (see PRESERVED_GLOBAL_TABLES).
 */
export async function qaResetUser(params: {
  userId: string;
  keepTraces?: boolean;
}): Promise<{ summary: QaResetSummary; preserved: readonly string[] }> {
  const { userId, keepTraces = false } = params;
  const summary: QaResetSummary = {};

  const searchPoolRows = await prisma.searchPool.findMany({
    where: { userId },
    select: { searchId: true },
  });
  const searchIds = [...new Set(searchPoolRows.map((r) => r.searchId))];

  if (searchIds.length) {
    summary.interaction_signal_dedup = (
      await prisma.interactionSignalDedup.deleteMany({
        where: { searchId: { in: searchIds } },
      })
    ).count;
  } else {
    summary.interaction_signal_dedup = 0;
  }

  summary.search_pools = (
    await prisma.searchPool.deleteMany({ where: { userId } })
  ).count;

  summary.extraction_runs = (
    await prisma.fashionExtractionRun.deleteMany({ where: { userId } })
  ).count;

  summary.request_events = (
    await prisma.fashionRequestEvent.deleteMany({ where: { userId } })
  ).count;

  summary.style_signals = (
    await prisma.fashionStyleSignal.deleteMany({ where: { userId } })
  ).count;

  // Clear self-referential superseded_by before deleting facts.
  const userFacts = await prisma.fashionFact.findMany({
    where: { userId },
    select: { id: true },
  });
  if (userFacts.length) {
    const factIds = userFacts.map((f) => f.id);
    summary.fashion_facts_superseded_cleared = (
      await prisma.fashionFact.updateMany({
        where: { supersededBy: { in: factIds } },
        data: { supersededBy: null },
      })
    ).count;
  } else {
    summary.fashion_facts_superseded_cleared = 0;
  }

  summary.fashion_facts = (
    await prisma.fashionFact.deleteMany({ where: { userId } })
  ).count;

  summary.people = (
    await prisma.fashionPerson.deleteMany({ where: { userId } })
  ).count;

  if (!keepTraces) {
    summary.traces = (
      await prisma.fashionTrace.deleteMany({ where: { userId } })
    ).count;
    // llm_calls + pipeline_events cascade from traces.
    summary.llm_calls = 0;
    summary.pipeline_events = 0;
  } else {
    summary.traces = 0;
    summary.llm_calls = 0;
    summary.pipeline_events = 0;
  }

  summary.conversations = (
    await prisma.conversation.deleteMany({ where: { userId } })
  ).count;
  // Message, MessageVersion, ConversationBranch, ConversationContextSummary cascade.

  return { summary, preserved: PRESERVED_GLOBAL_TABLES };
}
