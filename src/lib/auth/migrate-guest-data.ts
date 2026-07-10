import { prisma } from "@/lib/ai-chat/db";
import type { GuestLocalData } from "@/lib/client/guest-storage";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import { migrateGuestFashionMemoryToUser } from "@/lib/fashion-memory/migrate-guest";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";

async function reassignGuestUserId(guestUserId: string, realUserId: string) {
  await prisma.$transaction([
    prisma.conversation.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.shoppingMemoryJob.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.productCurationJob.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.shoppingMemory.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.memoryObservation.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.productInteraction.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.productCuration.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.shoppingProfileSummary.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.cartSession.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.savedAddress.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.categoryPreference.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.brandPreference.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.recipient.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.shoppingIntent.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.tasteTag.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.hardNegative.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.ownedProduct.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.sizingProfile.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.userProfile.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
  ]);
}

/** Import local guest conversations/messages that never reached the DB. */
async function importLocalGuestData(realUserId: string, data: GuestLocalData) {
  for (const summary of data.conversations) {
    const existing = await prisma.conversation.findFirst({
      where: { id: summary.id, userId: realUserId },
    });
    if (existing) continue;

    await prisma.conversation.create({
      data: {
        id: summary.id,
        userId: realUserId,
        title: summary.title,
        archived: summary.archived,
        deletedAt: summary.deletedAt ? new Date(summary.deletedAt) : null,
        pinned: summary.pinned,
        model: summary.model,
        temperature: summary.temperature,
        maxTokens: summary.maxTokens,
        responseStyle: summary.responseStyle,
        systemPrompt: summary.systemPrompt ?? null,
        createdAt: new Date(summary.createdAt),
        updatedAt: new Date(summary.updatedAt),
      },
    });

    const { bootstrapConversationBranch } = await import(
      "@/lib/ai-chat/intent-branch/bootstrap"
    );
    await bootstrapConversationBranch({
      conversationId: summary.id,
      title: summary.title,
    });

    const messages = data.messagesByConversationId[summary.id] ?? [];
    if (messages.length === 0) continue;

    await prisma.message.createMany({
      data: messages.map((m) => ({
        id: m.id,
        conversationId: summary.id,
        role: m.role,
        content: m.content,
        status: m.status,
        model: m.model ?? null,
        finishReason: m.finishReason ?? null,
        error: m.error ?? null,
        metadata: (m.metadata ?? null) as InputJsonValue,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt),
      })),
      skipDuplicates: true,
    });
  }
}

export async function migrateGuestDataToUser(params: {
  guestId: string;
  realUserId: string;
  localData?: GuestLocalData;
}) {
  const guestUserId = guestUserIdFromSessionId(params.guestId);
  await reassignGuestUserId(guestUserId, params.realUserId);
  if (params.localData) {
    await importLocalGuestData(params.realUserId, params.localData);
    if (params.localData.fashionMemory) {
      await migrateGuestFashionMemoryToUser({
        realUserId: params.realUserId,
        snapshot: params.localData.fashionMemory,
      });
    }
  }
  return { guestUserId };
}
