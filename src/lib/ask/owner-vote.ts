import { prisma } from "@/lib/ai-chat/db";
import { isAskVoteChoice, type AskVoteChoice } from "./types";

export function ownerVoterKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * Create or replace the share owner's poll vote (No / Meh / Almost / Love).
 * Friends cannot use this — vote route gates on ownership separately.
 */
export async function upsertOwnerAskVote(params: {
  shareId: string;
  ownerUserId: string;
  askerName: string;
  choice: AskVoteChoice;
}) {
  if (!isAskVoteChoice(params.choice)) {
    throw new Error("Invalid owner vote choice.");
  }
  const voterKey = ownerVoterKey(params.ownerUserId);
  const displayName =
    params.askerName.trim().slice(0, 40) || "Friend";

  return prisma.lookAskVote.upsert({
    where: {
      shareId_voterKey: { shareId: params.shareId, voterKey },
    },
    create: {
      shareId: params.shareId,
      voterKey,
      displayName,
      userId: params.ownerUserId,
      choice: params.choice,
    },
    update: {
      choice: params.choice,
      displayName,
      userId: params.ownerUserId,
    },
  });
}

export async function loadShareByGenerationForOwner(params: {
  ownerUserId: string;
  generationId: string;
}) {
  const generationId = params.generationId.trim();
  if (!generationId) return null;
  return prisma.lookAskShare.findFirst({
    where: {
      ownerUserId: params.ownerUserId,
      generationId,
    },
    orderBy: { createdAt: "desc" },
    include: {
      votes: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });
}

/** Owner's shared Ask cards, newest first. */
export async function listSharesForOwner(params: {
  ownerUserId: string;
  take?: number;
}) {
  const take = Math.min(Math.max(params.take ?? 40, 1), 100);
  return prisma.lookAskShare.findMany({
    where: { ownerUserId: params.ownerUserId },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      votes: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
}
