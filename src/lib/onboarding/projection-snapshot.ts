import { prisma } from "@/lib/ai-chat/db";

export async function loadOnboardingProjectionSnapshot(userId: string) {
  const [profile, sizing, tasteTags, brandPreferences, hardNegatives] =
    await Promise.all([
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.sizingProfile.findUnique({ where: { userId } }),
      prisma.tasteTag.findMany({
        where: { userId },
        orderBy: [{ polarity: "asc" }, { score: "desc" }],
        take: 48,
      }),
      prisma.brandPreference.findMany({
        where: { userId },
        orderBy: [{ sentiment: "asc" }, { strength: "desc" }],
        take: 32,
      }),
      prisma.hardNegative.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }],
        take: 32,
      }),
    ]);
  return { profile, sizing, tasteTags, brandPreferences, hardNegatives };
}

export type OnboardingProjectionSnapshot = Awaited<
  ReturnType<typeof loadOnboardingProjectionSnapshot>
>;
