import { isSupabaseAuthUserId } from "../auth";
import { ensureSelfPerson, listPeopleForUser } from "../people";
import type { ExtractionOpResult } from "../types";
import { applyFashionOpsTraced } from "./apply-ops";
import {
  attachParkedOps,
  mergeAmbiguousSubjects,
} from "../unresolved";
import { runRequestEventCorroboration } from "./corroboration";
import { evaluateFashionExtractionGate } from "./gate";
import { assembleExtractionContext } from "./assemble-context";
import { newMessageTextsFromContextBlock } from "./evidence";
import { extractFashionMemoryFromTurn } from "./llm-extract";
import {
  loadFashionTurnMessages,
  logFashionExtractionFailed,
  logFashionExtractionSkip,
  partitionFashionTurnMessages,
} from "./message-window";
import {
  beginExtractionRun,
  finishExtractionRun,
  getDoneExtractionWatermark,
  hasRecentRunningExtraction,
} from "../extraction-runs";

export type RunFashionExtractionParams = {
  userId: string;
  conversationId: string;
  triggerMessageId?: string;
  sweep?: boolean;
  signal?: AbortSignal;
  traceId?: string | null;
};

export type RunFashionExtractionResult = {
  runId?: string;
  skipped?: boolean;
  skipReason?: string;
  ops: ExtractionOpResult[];
};

export async function runFashionExtraction(
  params: RunFashionExtractionParams,
): Promise<RunFashionExtractionResult> {
  if (!isSupabaseAuthUserId(params.userId)) {
    return { skipped: true, skipReason: "guest_user", ops: [] };
  }

  if (
    await hasRecentRunningExtraction({
      userId: params.userId,
      conversationId: params.conversationId,
    })
  ) {
    logFashionExtractionSkip({
      userId: params.userId,
      conversationId: params.conversationId,
      reason: "concurrent_running",
      sweep: params.sweep,
    });
    return { skipped: true, skipReason: "concurrent_running", ops: [] };
  }

  const watermark = await getDoneExtractionWatermark({
    userId: params.userId,
    conversationId: params.conversationId,
  });

  const turnMessages = await loadFashionTurnMessages({
    conversationId: params.conversationId,
    afterMessageId: watermark,
  });
  const { ordered, newUserMessages } = partitionFashionTurnMessages(turnMessages);

  if (!params.sweep) {
    const gate = evaluateFashionExtractionGate({
      newUserMessages,
      orderedMessages: ordered,
    });
    if (!gate.proceed) {
      logFashionExtractionSkip({
        userId: params.userId,
        conversationId: params.conversationId,
        reason: gate.reason,
      });
      return { skipped: true, skipReason: gate.reason, ops: [] };
    }
  } else if (!newUserMessages.length) {
    logFashionExtractionSkip({
      userId: params.userId,
      conversationId: params.conversationId,
      reason: "no_new_user_messages",
      sweep: true,
    });
    return { skipped: true, skipReason: "no_new_user_messages", ops: [] };
  }

  const newestUser = newUserMessages[newUserMessages.length - 1]!;
  const run = await beginExtractionRun({
    userId: params.userId,
    conversationId: params.conversationId,
    lastMessageId: newestUser.id,
  });

  const allOps: ExtractionOpResult[] = [];

  try {
    await ensureSelfPerson(params.userId);

    const [context, people] = await Promise.all([
      assembleExtractionContext({
        userId: params.userId,
        conversationId: params.conversationId,
      }),
      listPeopleForUser(params.userId),
    ]);

    const extracted = await extractFashionMemoryFromTurn({
      context,
      signal: params.signal,
      traceId: params.traceId,
    });

    const newMessageTexts = newMessageTextsFromContextBlock(context.messages);

    const applied = await applyFashionOpsTraced({
      userId: params.userId,
      ops: extracted.ops,
      personShortIds: context.personShortIds,
      people,
      newMessageTexts,
    });
    allOps.push(...applied.results);

    const self = await ensureSelfPerson(params.userId);
    allOps.push(
      ...(await runRequestEventCorroboration({
        userId: params.userId,
        personId: self.id,
      })),
    );

    await finishExtractionRun({
      userId: params.userId,
      runId: run.id,
      status: "done",
      opsApplied: allOps,
      ambiguousSubjects: attachParkedOps(
        mergeAmbiguousSubjects(
          extracted.ambiguous_subjects,
          applied.unresolvedSubjects,
        ),
        applied.parkedOps,
      ),
    });

    return { runId: run.id, ops: allOps };
  } catch (error) {
    await finishExtractionRun({
      userId: params.userId,
      runId: run.id,
      status: "failed",
      opsApplied: [
        ...allOps,
        {
          op: "pipeline",
          accepted: false,
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    }).catch(() => undefined);

    logFashionExtractionFailed({
      userId: params.userId,
      conversationId: params.conversationId,
      error,
      sweep: params.sweep,
    });

    return { skipped: true, skipReason: "failed", ops: allOps };
  }
}
