import { prisma } from "@/lib/ai-chat/db";
import { latestBiometricConsent } from "./consents";

export async function exportUserData(userId: string) {
  const [
    profile,
    sizing,
    consents,
    latestConsent,
    shares,
    conversations,
    photoAnalyses,
    categoryPreferences,
    brandPreferences,
    tasteTags,
    hardNegatives,
    ownedProducts,
  ] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.sizingProfile.findUnique({ where: { userId } }),
    prisma.biometricConsent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    latestBiometricConsent(userId),
    prisma.lookAskShare.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        token: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        askerName: true,
        serial: true,
      },
    }),
    prisma.conversation.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true, createdAt: true },
        },
      },
    }),
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, "photoHash", status, "createdAt"
      FROM "PhotoAnalysis"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC
    `,
    prisma.categoryPreference.findMany({ where: { userId } }),
    prisma.brandPreference.findMany({ where: { userId } }),
    prisma.tasteTag.findMany({ where: { userId } }),
    prisma.hardNegative.findMany({ where: { userId } }),
    prisma.ownedProduct.findMany({ where: { userId } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    account: {
      userId,
      email: null as string | null,
    },
    profile,
    sizing,
    biometricConsent: latestConsent,
    biometricConsentHistory: consents,
    sharedLooks: shares,
    conversations,
    photoAnalyses,
    categoryPreferences,
    brandPreferences,
    tasteTags,
    hardNegatives,
    ownedProducts,
  };
}
