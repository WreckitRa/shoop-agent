import { prisma } from "../db";
import { classifySearchMissionShift } from "./classify-shift";
import {
  INTENT_BRANCH_COOLDOWN_MS,
  INTENT_SHIFT_CONFIDENCE_THRESHOLD,
  isIntentBranchDryRun,
  isIntentBranchEnabled,
  MAX_INTENT_BRANCHES_PER_HOUR,
} from "./constants";
import { logIntentBranch } from "./debug-log";
import { getOrCreateActiveBranchId } from "./bootstrap";
import { loadPreviousSearchMission } from "./load-previous-search";
import {
  deriveBranchTitleFromQuery,
  fastPathSearchMissionDecision,
  type SearchMissionSnapshot,
} from "./search-mission";

export async function processIntentShiftForSearch(params: {
  userId: string;
  conversationId: string;
  userMessageId: string;
  branchId: string;
  currentMission: SearchMissionSnapshot;
  signal?: AbortSignal;
}): Promise<{ created: boolean; branchId?: string; title?: string }> {
  const { conversationId, userMessageId, branchId, currentMission, signal } =
    params;

  logIntentBranch("process_start", {
    conversationId,
    messageId: userMessageId,
    branchId,
    currentMission,
    enabled: isIntentBranchEnabled(),
    dryRun: isIntentBranchDryRun(),
  });

  if (!isIntentBranchEnabled()) {
    logIntentBranch("skipped", { conversationId, messageId: userMessageId, reason: "disabled" });
    return { created: false };
  }

  const existingForMessage = await prisma.conversationBranch.findFirst({
    where: { sourceMessageId: userMessageId },
  });
  if (existingForMessage) {
    logIntentBranch("skipped", {
      conversationId,
      messageId: userMessageId,
      reason: "already_split_for_message",
      branchId: existingForMessage.id,
      title: existingForMessage.title,
    });
    return {
      created: false,
      branchId: existingForMessage.id,
      title: existingForMessage.title,
    };
  }

  const activeBranch = await prisma.conversationBranch.findFirst({
    where: { id: branchId, conversationId },
  });
  if (!activeBranch) {
    await getOrCreateActiveBranchId(conversationId);
    logIntentBranch("skipped", {
      conversationId,
      messageId: userMessageId,
      reason: "branch_missing",
    });
    return { created: false };
  }

  const previousMission = await loadPreviousSearchMission({
    conversationId,
    branchId: activeBranch.id,
    beforeUserMessageId: userMessageId,
  });

  if (!previousMission) {
    logIntentBranch("skipped", {
      conversationId,
      messageId: userMessageId,
      reason: "no_previous_search",
    });
    return { created: false };
  }

  logIntentBranch("compare_searches", {
    conversationId,
    messageId: userMessageId,
    previous: previousMission,
    current: currentMission,
  });

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [recentBranchCount, latestSplit] = await Promise.all([
    prisma.conversationBranch.count({
      where: {
        conversationId,
        createdAt: { gte: hourAgo },
        index: { gt: 0 },
      },
    }),
    prisma.conversationBranch.findFirst({
      where: { conversationId, index: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  if (recentBranchCount >= MAX_INTENT_BRANCHES_PER_HOUR) {
    logIntentBranch("skipped", {
      conversationId,
      messageId: userMessageId,
      reason: "rate_limit",
      recentBranchCount,
    });
    return { created: false };
  }

  if (
    latestSplit &&
    Date.now() - latestSplit.createdAt.getTime() < INTENT_BRANCH_COOLDOWN_MS
  ) {
    logIntentBranch("skipped", {
      conversationId,
      messageId: userMessageId,
      reason: "cooldown",
      msSinceLastSplit: Date.now() - latestSplit.createdAt.getTime(),
    });
    return { created: false };
  }

  const fast = fastPathSearchMissionDecision(previousMission, currentMission);
  let classificationSource: "fast_path" | "llm" = "fast_path";
  let isNewIntent: boolean;
  let confidence: number;
  let suggestedTitle: string;

  if (fast) {
    isNewIntent = fast.split;
    confidence = fast.split ? 0.9 : 0.95;
    suggestedTitle =
      fast.suggestedTitle ?? deriveBranchTitleFromQuery(currentMission.query);
    logIntentBranch("fast_path_decision", {
      conversationId,
      messageId: userMessageId,
      ...fast,
      isNewIntent,
      confidence,
      suggestedTitle,
    });
  } else {
    classificationSource = "llm";
    const llm = await classifySearchMissionShift({
      previous: previousMission,
      current: currentMission,
      signal,
      audit: {
        userId: params.userId,
        kind: "intent_shift",
        conversationId,
        userMessageId,
        sequence: 0,
      },
    });
    if (!llm) {
      logIntentBranch("skipped", {
        conversationId,
        messageId: userMessageId,
        reason: "classifier_null",
      });
      return { created: false };
    }
    isNewIntent = llm.isNewIntent;
    confidence = llm.confidence;
    suggestedTitle =
      llm.suggestedTitle.trim() ||
      deriveBranchTitleFromQuery(currentMission.query);
  }

  const shouldSplit =
    isNewIntent &&
    confidence >= INTENT_SHIFT_CONFIDENCE_THRESHOLD &&
    suggestedTitle.length > 0;

  logIntentBranch("classifier_result", {
    conversationId,
    messageId: userMessageId,
    source: classificationSource,
    isNewIntent,
    confidence,
    suggestedTitle,
    confidenceThreshold: INTENT_SHIFT_CONFIDENCE_THRESHOLD,
    shouldSplit,
    dryRun: isIntentBranchDryRun(),
  });

  if (isIntentBranchDryRun()) {
    logIntentBranch("dry_run_would_split", {
      conversationId,
      messageId: userMessageId,
      wouldCreate: shouldSplit,
    });
    return { created: false };
  }

  if (!shouldSplit) {
    logIntentBranch("skipped", {
      conversationId,
      messageId: userMessageId,
      reason: "same_mission",
      isNewIntent,
      confidence,
    });
    return { created: false };
  }

  const nextIndex = activeBranch.index + 1;
  const title = suggestedTitle.slice(0, 120) || "New topic";

  const branch = await prisma.conversationBranch.create({
    data: {
      conversationId,
      index: nextIndex,
      title,
      anchorMessageId: userMessageId,
      sourceMessageId: userMessageId,
      confidence,
    },
  });

  await prisma.message.update({
    where: { id: userMessageId },
    data: { branchId: branch.id },
  });

  const ordered: { id: string; role: string }[] = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, role: true },
  });
  const msgIdx = ordered.findIndex((m) => m.id === userMessageId);
  let assistantReassigned = false;
  if (msgIdx >= 0) {
    const next = ordered[msgIdx + 1];
    if (next?.role === "assistant") {
      await prisma.message.update({
        where: { id: next.id },
        data: { branchId: branch.id },
      });
      assistantReassigned = true;
    }
  }

  logIntentBranch("created", {
    conversationId,
    messageId: userMessageId,
    branchId: branch.id,
    index: nextIndex,
    title,
    confidence,
    classificationSource,
    assistantReassigned,
    previous: previousMission,
    current: currentMission,
  });

  return { created: true, branchId: branch.id, title };
}
