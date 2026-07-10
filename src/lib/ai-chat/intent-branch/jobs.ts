import {
  INTENT_PIPELINE_TIMEOUT_MS,
  INTENT_WORKER_DEFER_MS,
  isIntentBranchEnabled,
} from "./constants";
import { logIntentBranch } from "./debug-log";
import { processIntentShiftForSearch } from "./process";
import type { SearchMissionSnapshot } from "./search-mission";

/**
 * After a successful catalog search, compare against the previous search mission
 * and maybe create a sidebar branch. Deferred slightly so message metadata is
 * persisted before we read prior searches.
 */
export function spawnSearchIntentPipeline(params: {
  userId: string;
  conversationId: string;
  userMessageId: string;
  branchId: string;
  currentMission: SearchMissionSnapshot;
}) {
  if (!isIntentBranchEnabled()) {
    logIntentBranch("spawn_skipped", {
      conversationId: params.conversationId,
      messageId: params.userMessageId,
      reason: "disabled",
    });
    return;
  }

  logIntentBranch("spawn_called", {
    conversationId: params.conversationId,
    messageId: params.userMessageId,
    branchId: params.branchId,
    currentMission: params.currentMission,
  });

  setTimeout(() => {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), INTENT_PIPELINE_TIMEOUT_MS);
    void processIntentShiftForSearch({
      ...params,
      signal: ac.signal,
    })
      .then((result) => {
        logIntentBranch("pipeline_completed", {
          conversationId: params.conversationId,
          messageId: params.userMessageId,
          ...result,
        });
      })
      .catch((error) => {
        logIntentBranch("pipeline_failed", {
          conversationId: params.conversationId,
          messageId: params.userMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => clearTimeout(timeout));
  }, INTENT_WORKER_DEFER_MS);
}
