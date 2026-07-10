import { patchAssistantProductSearchCuration } from "../chat-service";
import { logAiChat } from "../observability";
import type { CuratedPick, ProductSearchInvocation } from "../types";
import { stripSearchVariantsForClient } from "@/lib/shopify/resolve-display-variant";
import { persistCuratedPicks, type CuratorContext } from "./curator";

export type ScheduleProductCurationParams = {
  ctx: CuratorContext;
  invocation: ProductSearchInvocation;
  heuristicPicks: CuratedPick[];
  cardCount: number;
  /** @deprecated Deep curation removed — SSE patch unused. */
  pushProductSearchUpdate?: (picks: CuratedPick[], fallback: boolean) => void;
};

/**
 * After a legacy catalog search: persist picks for the PDP and mark curation
 * complete immediately. Search-engine results are already final in run-chat-stream;
 * this path only handles the legacy single-query fallback.
 */
export function scheduleProductCurationForSearch(
  params: ScheduleProductCurationParams,
): void {
  const { ctx, heuristicPicks } = params;
  const picks = heuristicPicks.map(stripSearchVariantsForClient);
  finalizeSearchCuration(params, picks);
}

function finalizeSearchCuration(
  params: ScheduleProductCurationParams,
  picks: CuratedPick[],
): void {
  const { ctx, invocation } = params;

  if (picks.length) {
    void persistCuratedPicks(ctx, picks).catch((error) => {
      logAiChat("warn", "curator_heuristic_persist_failed", {
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        searchKey: ctx.searchKey,
        error,
      });
    });
  }

  invocation.curatedPicks = picks;
  invocation.curationFallback = false;
  invocation.curationPending = false;

  if (!ctx.messageId || !ctx.searchKey) return;

  void patchAssistantProductSearchCuration({
    messageId: ctx.messageId,
    searchKey: ctx.searchKey,
    curatedPicks: picks,
    curationFallback: false,
  }).catch((error) => {
    logAiChat("warn", "curator_finalize_patch_failed", {
      messageId: ctx.messageId,
      searchKey: ctx.searchKey,
      error,
    });
  });
}
