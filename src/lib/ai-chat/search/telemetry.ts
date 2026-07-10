/**
 * Stage 6 — query-yield telemetry (docs/search-improvements.md §13).
 *
 * Each portfolio query's contribution is logged to `SearchQueryYield` so a
 * nightly job can fold yields into per-category pattern weights (learned query
 * angles replace guesses over time). Best-effort: never throws into the stream.
 */
import { prisma } from "../db";
import { logAiChat } from "../observability";
import type { QueryYieldStat } from "./pool";
import type { SearchBrief } from "./types";

export async function recordSearchQueryYields(params: {
  userId: string;
  conversationId?: string | null;
  searchKey?: string | null;
  brief: SearchBrief;
  stats: QueryYieldStat[];
}): Promise<void> {
  if (!params.stats.length) return;
  try {
    const delegate = (
      prisma as unknown as {
        searchQueryYield?: {
          createMany?: (args: {
            data: Array<Record<string, unknown>>;
          }) => Promise<unknown>;
        };
      }
    ).searchQueryYield;
    if (!delegate?.createMany) return;
    await delegate.createMany({
      data: params.stats.map((s) => ({
        userId: params.userId,
        conversationId: params.conversationId ?? null,
        searchKey: params.searchKey ?? null,
        queryText: s.text.slice(0, 500),
        archetype: params.brief.archetype,
        category: params.brief.category ?? null,
        directionLabel: params.brief.directionLabel ?? null,
        rankingProfile: params.brief.rankingProfile,
        rawCount: s.rawCount,
        poolContribution: s.poolContribution,
      })),
    });
  } catch (error) {
    logAiChat("warn", "search_query_yield_record_failed", {
      conversationId: params.conversationId,
      error: String(error).slice(0, 160),
    });
  }
}
