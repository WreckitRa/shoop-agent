import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { prisma } from "@/lib/ai-chat/db";
import { trackProductEvent } from "@/lib/analytics/track";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import type {
  LookScanPiece,
  LookScanVerdict,
} from "@/lib/tryon/look-scan-types";
import {
  durableAskImageStorageRef,
  publicAskImagePath,
} from "./ask-image";
import {
  mapVerdictToCompareVote,
  mapVerdictToShoopVote,
} from "./map-shoop-vote";
import { upsertOwnerAskVote } from "./owner-vote";
import { generateAskToken } from "./public-payload";
import { isShareLive, shareExpiresAt } from "@/lib/legal/share-lifetime";
import {
  isAskCompareChoice,
  isAskRateChoice,
  type AskExtraLookStored,
  type AskVoteChoice,
} from "./types";

export type CreateLookAskInput = {
  userId: string;
  imageUrl: string;
  pieces: LookScanPiece[];
  verdict: LookScanVerdict;
  generationId?: string | null;
  conversationId?: string | null;
  killCount?: number | null;
  /** Owner's strip vote to seed on the shared card. */
  ownerVote?: AskVoteChoice | null;
  /** Extra looks after this one — comparative when any are set. */
  extraLooks?: Array<{
    imageUrl: string;
    generationId?: string | null;
    title?: string | null;
  }> | null;
  lookTitle?: string | null;
};

export async function createLookAskShare(input: CreateLookAskInput) {
  const extrasIn = (input.extraLooks ?? [])
    .map((row) => ({
      imageUrl: row.imageUrl.trim(),
      generationId: row.generationId?.trim() || null,
      title: row.title?.trim() || "",
    }))
    .filter((row) => row.imageUrl)
    .slice(0, 4);
  const hasAlt = extrasIn.length > 0;
  const pollMode = hasAlt ? "compare" : "rate";
  const shoopVote =
    pollMode === "compare"
      ? mapVerdictToCompareVote(input.verdict)
      : mapVerdictToShoopVote(input.verdict);
  const status = await getOnboardingStatus(input.userId);
  const askerName = status.profile?.preferredName?.trim() || "A friend";

  const agg = await prisma.lookAskShare.aggregate({
    _max: { serial: true },
  });
  const serial = (agg._max.serial ?? 41) + 1;

  let token = generateAskToken();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.lookAskShare.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!exists) break;
    token = generateAskToken();
  }

  const publicImage = publicAskImagePath(token);
  const storageRef = await durableAskImageStorageRef({
    userId: input.userId,
    generationId: input.generationId,
    fallbackImageUrl: input.imageUrl,
  });
  const extraStored: AskExtraLookStored[] = [];
  for (const extra of extrasIn) {
    extraStored.push({
      generationId: extra.generationId,
      title: extra.title,
      imageUrl: await durableAskImageStorageRef({
        userId: input.userId,
        generationId: extra.generationId,
        fallbackImageUrl: extra.imageUrl,
      }),
    });
  }
  const firstExtra = extraStored[0] ?? null;

  let messageId: string | null = null;
  const conversationId = input.conversationId?.trim() || null;

  if (conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: input.userId, deletedAt: null },
      select: { id: true },
    });
    if (conv) {
      const title = input.verdict.verdict_title.trim();
      const body = input.verdict.verdict_body.trim();
      const content = [
        `I studied this look on you.`,
        ``,
        `**Verdict: ${title}**`,
        body,
        ``,
        pollMode === "compare"
          ? `Ask your friends — which look? They pick before they peek at mine.`
          : `Ask your friends — share the card and let them vote before they peek at mine.`,
      ].join("\n");

      const msg = await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: "assistant",
          content,
          status: "completed",
          metadata: {
            lookAsk: {
              token,
              imageUrl: publicImage,
              verdictTitle: title,
              askPath: `/ask/${token}`,
              shoopVote,
              pollMode,
            },
          },
        },
      });
      messageId = msg.id;
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date() },
      });
    }
  }

  const share = await prisma.lookAskShare.create({
    data: {
      token,
      ownerUserId: input.userId,
      generationId: input.generationId ?? null,
      conversationId,
      messageId,
      imageUrl: storageRef,
      altImageUrl: firstExtra?.imageUrl ?? null,
      altGenerationId: firstExtra?.generationId ?? null,
      extraLooks: extraStored as unknown as InputJsonValue,
      lookTitle: input.lookTitle?.trim() || null,
      pollMode,
      pieces: input.pieces,
      shoopVerdict: input.verdict,
      shoopVote,
      askerName,
      serial,
      killCount:
        typeof input.killCount === "number" && Number.isFinite(input.killCount)
          ? Math.max(0, Math.round(input.killCount))
          : null,
      expiresAt: shareExpiresAt(),
    },
  });

  trackProductEvent({
    name: "friend_ask_sent",
    userId: input.userId,
    props: {
      share_id: share.id,
      token: share.token,
      generation_id: share.generationId,
      piece_count: Array.isArray(input.pieces) ? input.pieces.length : 0,
      poll_mode: pollMode,
    },
  });

  const ownerVoteRaw = input.ownerVote;
  let ownerVote: AskVoteChoice | null = null;
  if (pollMode === "compare") {
    if (isAskCompareChoice(ownerVoteRaw)) ownerVote = ownerVoteRaw;
    else if (isAskRateChoice(ownerVoteRaw)) {
      ownerVote =
        ownerVoteRaw === "love" || ownerVoteRaw === "almost" ? "a" : "b";
    }
  } else if (isAskRateChoice(ownerVoteRaw)) {
    ownerVote = ownerVoteRaw;
  }
  if (ownerVote) {
    await upsertOwnerAskVote({
      shareId: share.id,
      ownerUserId: input.userId,
      askerName,
      choice: ownerVote,
    });
  }

  return share;
}

export async function loadShareByToken(token: string) {
  const share = await prisma.lookAskShare.findUnique({
    where: { token },
    include: {
      votes: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });
  if (!share || !isShareLive(share)) return null;
  return share;
}

export async function revokeShareByToken(params: {
  token: string;
  ownerUserId?: string;
  reason: string;
}) {
  const share = await prisma.lookAskShare.findUnique({
    where: { token: params.token },
    select: { id: true, ownerUserId: true, revokedAt: true },
  });
  if (!share) return null;
  if (params.ownerUserId && share.ownerUserId !== params.ownerUserId) {
    return null;
  }
  if (share.revokedAt) return share;
  return prisma.lookAskShare.update({
    where: { token: params.token },
    data: { revokedAt: new Date(), revokeReason: params.reason.slice(0, 120) },
  });
}
