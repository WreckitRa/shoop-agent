import { prisma } from "@/lib/ai-chat/db";
import { getAuthContext } from "@/lib/auth/session";

/**
 * Wipes ALL shopper memory for the current user: raw observations, canonical
 * memories, profile summary, product interactions, AND the typed projection
 * tables (UserProfile, SizingProfile, CategoryPreference, BrandPreference,
 * Recipient, ShoppingIntent, TasteTag, HardNegative).
 */
export async function POST() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    await prisma.$transaction([
      prisma.shoppingMemory.deleteMany({ where: { userId } }),
      prisma.memoryObservation.deleteMany({ where: { userId } }),
      prisma.productInteraction.deleteMany({ where: { userId } }),
      prisma.shoppingProfileSummary.deleteMany({ where: { userId } }),
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
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Clear failed." }, { status: 500 });
  }
}
