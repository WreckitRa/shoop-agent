import { prisma } from "@/lib/ai-chat/db";
import { qaResetUser } from "@/lib/qa/reset-user";
import { listPeopleForUser } from "@/lib/fashion-memory/people";
import { isSupabaseAuthUserId } from "@/lib/fashion-memory/auth";
import { purgePersonTryonData } from "@/lib/tryon/delete";
import { withdrawBiometricConsent } from "./consents";

export async function hasBiometricResidue(userId: string): Promise<boolean> {
  const photos = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "PhotoAnalysis" WHERE "userId" = ${userId} LIMIT 1
  `;
  if (photos.length) return true;

  const gen = await prisma.tryonGeneration.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (gen) return true;

  if (!isSupabaseAuthUserId(userId)) return false;
  const people = await listPeopleForUser(userId);
  return people.some((person) => {
    const row = person as typeof person & {
      avatar?: unknown;
      avatar_source_photo_path?: string | null;
    };
    return Boolean(row.avatar) || Boolean(row.avatar_source_photo_path);
  });
}

export async function purgeBiometricData(userId: string): Promise<void> {
  await withdrawBiometricConsent(userId);

  await prisma.$executeRaw`
    DELETE FROM "PhotoAnalysis" WHERE "userId" = ${userId}
  `;

  if (isSupabaseAuthUserId(userId)) {
    const people = await listPeopleForUser(userId);
    for (const person of people) {
      await purgePersonTryonData({ userId, personId: person.id });
    }
  }

  await prisma.tryonGeneration.deleteMany({ where: { userId } }).catch(() => undefined);
}

export async function deleteAllUserData(userId: string): Promise<void> {
  await purgeBiometricData(userId);

  await prisma.lookAskShare.deleteMany({ where: { ownerUserId: userId } });
  await prisma.productCuration.deleteMany({ where: { userId } });
  await prisma.productInteraction.deleteMany({ where: { userId } });
  await prisma.cartSession.deleteMany({ where: { userId } });
  await prisma.savedAddress.deleteMany({ where: { userId } });
  await prisma.categoryPreference.deleteMany({ where: { userId } });
  await prisma.brandPreference.deleteMany({ where: { userId } });
  await prisma.recipient.deleteMany({ where: { userId } });
  await prisma.shoppingIntent.deleteMany({ where: { userId } });
  await prisma.tasteTag.deleteMany({ where: { userId } });
  await prisma.hardNegative.deleteMany({ where: { userId } });
  await prisma.ownedProduct.deleteMany({ where: { userId } });
  await prisma.sizingProfile.deleteMany({ where: { userId } });
  await prisma.biometricConsent.deleteMany({ where: { userId } });

  if (isSupabaseAuthUserId(userId)) {
    await qaResetUser({ userId });
  } else {
    await prisma.conversation.deleteMany({ where: { userId } });
  }

  await prisma.userProfile.deleteMany({ where: { userId } });
}
