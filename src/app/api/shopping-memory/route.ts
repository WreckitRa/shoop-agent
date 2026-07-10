import { prisma } from "@/lib/ai-chat/db";
import { refreshTypedProfileIntoShoppingView } from "@/lib/onboarding/sync-profile-summary";
import { getAuthContext } from "@/lib/auth/session";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { preferredName: true },
    });
    if (profile?.preferredName) {
      const onboardingMemoryCount = await prisma.shoppingMemory.count({
        where: { userId, memoryKey: { startsWith: "onboarding." } },
      });
      if (onboardingMemoryCount === 0) {
        await refreshTypedProfileIntoShoppingView(userId).catch(() => {});
      }
    }

    const [summary, memories, observationCount] = await Promise.all([
      prisma.shoppingProfileSummary.findUnique({ where: { userId } }),
      prisma.shoppingMemory.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }],
        take: 300,
        select: {
          id: true,
          memoryKey: true,
          value: true,
          type: true,
          scope: true,
          category: true,
          brand: true,
          confidence: true,
          importance: true,
          isHardRule: true,
          isActive: true,
          evidenceCount: true,
          expiresAt: true,
          updatedAt: true,
        },
      }),
      prisma.memoryObservation.count({ where: { userId } }),
    ]);

    return Response.json({
      summary,
      memories,
      observationCount,
    });
  } catch {
    return Response.json(
      { error: "Could not load shopping memory." },
      { status: 500 },
    );
  }
}
