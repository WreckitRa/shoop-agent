import { prisma } from "../db";
import { NEW_CHAT_TITLE } from "../constants";

/** Create branch index 0 for a new or legacy conversation without branches. */
export async function bootstrapConversationBranch(params: {
  conversationId: string;
  title: string;
  anchorMessageId?: string | null;
}) {
  const existing = await prisma.conversationBranch.findFirst({
    where: { conversationId: params.conversationId, index: 0 },
  });
  if (existing) return existing;

  let anchorId = params.anchorMessageId ?? null;
  if (!anchorId) {
    const firstUser = await prisma.message.findFirst({
      where: { conversationId: params.conversationId, role: "user" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const firstAny = await prisma.message.findFirst({
      where: { conversationId: params.conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    anchorId = firstUser?.id ?? firstAny?.id ?? null;
  }

  const title =
    params.title.trim() || NEW_CHAT_TITLE;

  const branch = await prisma.conversationBranch.create({
    data: {
      conversationId: params.conversationId,
      index: 0,
      title,
      anchorMessageId: anchorId,
    },
  });

  if (anchorId) {
    await prisma.message.updateMany({
      where: {
        conversationId: params.conversationId,
        branchId: null,
      },
      data: { branchId: branch.id },
    });
  }

  return branch;
}

/** Set branch 0 anchor after the first user message is created. */
export async function anchorBootstrapBranchIfNeeded(
  conversationId: string,
  userMessageId: string,
) {
  const branch = await prisma.conversationBranch.findFirst({
    where: { conversationId, index: 0 },
  });
  if (!branch) return;

  if (!branch.anchorMessageId) {
    await prisma.conversationBranch.update({
      where: { id: branch.id },
      data: { anchorMessageId: userMessageId },
    });
  }

  await prisma.message.updateMany({
    where: {
      conversationId,
      id: userMessageId,
      branchId: null,
    },
    data: { branchId: branch.id },
  });
}

/** Latest branch by index; bootstraps index 0 when missing. */
export async function getOrCreateActiveBranchId(
  conversationId: string,
  conversationTitle?: string,
): Promise<string> {
  const latest = await prisma.conversationBranch.findFirst({
    where: { conversationId },
    orderBy: { index: "desc" },
    select: { id: true },
  });
  if (latest) return latest.id;

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { title: true },
  });
  const branch = await bootstrapConversationBranch({
    conversationId,
    title: conversationTitle ?? conv?.title ?? NEW_CHAT_TITLE,
  });
  return branch.id;
}
