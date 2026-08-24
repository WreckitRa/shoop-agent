import { prisma } from "@/lib/ai-chat/db";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import type {
  LookScanPiece,
  LookScanVerdict,
} from "@/lib/tryon/look-scan-types";
import {
  durableAskImageStorageRef,
  publicAskImagePath,
} from "./ask-image";
import { mapVerdictToShoopVote } from "./map-shoop-vote";
import { upsertOwnerAskVote } from "./owner-vote";
import { generateAskToken } from "./public-payload";
import { isShareLive, shareExpiresAt } from "@/lib/legal/share-lifetime";
import { isAskVoteChoice, type AskVoteChoice } from "./types";

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
};

export async function createLookAskShare(input: CreateLookAskInput) {
  const shoopVote = mapVerdictToShoopVote(input.verdict);
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
        `Ask your friends — share the card and let them vote before they peek at mine.`,
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
      // Durable private path (or legacy URL) — clients always get publicAskImagePath.
      imageUrl: storageRef,
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

  const ownerVote =
    input.ownerVote && isAskVoteChoice(input.ownerVote) ?
      input.ownerVote
    : null;
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
