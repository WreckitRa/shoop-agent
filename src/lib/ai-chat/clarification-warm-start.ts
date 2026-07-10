import { prisma } from "@/lib/ai-chat/db";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import { loadWarmCandidatesForOptions } from "@/lib/ai-chat/clarification-option-previews";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { logAiChat } from "@/lib/ai-chat/observability";

/** Collect option ids from the most recent answered clarification or gift directions. */
export async function getRecentWarmOptionIds(
  conversationId: string,
): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      role: "assistant",
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { metadata: true },
  });

  for (const row of rows) {
    const meta = row.metadata as MessageMetadata | null;

    const clar = meta?.clarification;
    if (clar?.status === "answered" && clar.answers) {
      const ids = new Set<string>();
      for (const answer of Object.values(clar.answers)) {
        for (const oid of answer.optionIds ?? []) {
          if (oid !== "other") ids.add(oid);
        }
      }
      if (ids.size) return [...ids];
    }

    const gift = meta?.giftDirections;
    if (gift?.status === "answered" && gift.selected?.length) {
      const ids = gift.selected
        .map(
          (label) =>
            gift.directions.find((d) => d.label === label)?.id ??
            gift.directions.find(
              (d) => d.label.toLowerCase() === label.toLowerCase(),
            )?.id,
        )
        .filter((id): id is string => Boolean(id));
      if (ids.length) return ids;
    }
  }

  return [];
}

/** Merge warm preview-stashed catalog hits into the search candidate pool. */
export async function loadWarmSearchCandidates(params: {
  conversationId: string;
  optionIds?: string[];
}): Promise<CatalogProductSummary[]> {
  const optionIds =
    params.optionIds ??
    (await getRecentWarmOptionIds(params.conversationId));

  if (!optionIds.length) return [];

  const products = await loadWarmCandidatesForOptions({
    conversationId: params.conversationId,
    optionIds,
  });

  if (products.length) {
    logAiChat("info", "clarification_warm_candidates_merged", {
      tag: "clarification_warm_cache",
      conversationId: params.conversationId,
      optionIds,
      count: products.length,
    });
  }

  return products;
}
