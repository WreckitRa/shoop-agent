import { prisma } from "@/lib/ai-chat/db";
import { getAuthUser } from "@/lib/auth/session";

export async function getUserPreferredName(): Promise<string | null> {
  const user = await getAuthUser();
  if (!user) return null;

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { preferredName: true },
    });
    return profile?.preferredName?.trim() || null;
  } catch {
    // DB unavailable — client-side profile hydrate will fill the greeting later.
    return null;
  }
}
