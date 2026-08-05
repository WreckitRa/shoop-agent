import { prisma } from "@/lib/ai-chat/db";

/**
 * Deletes every Prisma row scoped to `userId` (chats, memory, cart, profile).
 */
export async function deleteAllUserData(userId: string) {
  await prisma.$transaction([
    prisma.conversation.deleteMany({ where: { userId } }),
    prisma.productCuration.deleteMany({ where: { userId } }),
    prisma.productInteraction.deleteMany({ where: { userId } }),
    prisma.cartSession.deleteMany({ where: { userId } }),
    prisma.savedAddress.deleteMany({ where: { userId } }),
    prisma.categoryPreference.deleteMany({ where: { userId } }),
    prisma.brandPreference.deleteMany({ where: { userId } }),
    prisma.recipient.deleteMany({ where: { userId } }),
    prisma.shoppingIntent.deleteMany({ where: { userId } }),
    prisma.tasteTag.deleteMany({ where: { userId } }),
    prisma.hardNegative.deleteMany({ where: { userId } }),
    prisma.ownedProduct.deleteMany({ where: { userId } }),
    prisma.sizingProfile.deleteMany({ where: { userId } }),
    prisma.userProfile.deleteMany({ where: { userId } }),
  ]);
}
