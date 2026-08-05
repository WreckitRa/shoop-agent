import { prisma } from "@/lib/ai-chat/db";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import type {
  LookScanPiece,
  LookScanVerdict,
} from "@/lib/tryon/look-scan-types";
import { mapVerdictToShoopVote } from "./map-shoop-vote";
import { upsertOwnerAskVote } from "./owner-vote";
import { generateAskToken } from "./public-payload";
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

      // Token known; metadata URL filled after we know origin on the client —
      // store relative path.
      const msg = await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: "assistant",
          content,
          status: "completed",
          metadata: {
            lookAsk: {
              token,
              imageUrl: input.imageUrl,
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
      imageUrl: input.imageUrl,
      pieces: input.pieces,
      shoopVerdict: input.verdict,
      shoopVote,
      askerName,
      serial,
      killCount:
        typeof input.killCount === "number" && Number.isFinite(input.killCount)
          ? Math.max(0, Math.round(input.killCount))
          : null,
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
  return prisma.lookAskShare.findUnique({
    where: { token },
    include: {
      votes: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });
}
