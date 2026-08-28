import { prisma } from "@/lib/ai-chat/db";
import { LEGAL_DOC_VERSION } from "@/lib/legal/constants";

export async function latestBiometricConsent(userId: string) {
  return prisma.biometricConsent.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function hasActiveBiometricConsent(userId: string): Promise<boolean> {
  const row = await latestBiometricConsent(userId);
  return Boolean(
    row &&
      !row.withdrawnAt &&
      row.documentVersion === LEGAL_DOC_VERSION,
  );
}

export async function recordBiometricConsent(
  userId: string,
  opts?: {
    ageAttested?: boolean;
    ownPhotoAttested?: boolean;
    abandonDeleteAck?: boolean;
  },
) {
  const flags = {
    ageAttested: Boolean(opts?.ageAttested),
    ownPhotoAttested: Boolean(opts?.ownPhotoAttested),
    abandonDeleteAck: Boolean(opts?.abandonDeleteAck),
  };
  const current = await latestBiometricConsent(userId);
  if (
    current &&
    !current.withdrawnAt &&
    current.documentVersion === LEGAL_DOC_VERSION &&
    current.ageAttested === flags.ageAttested &&
    current.ownPhotoAttested === flags.ownPhotoAttested &&
    current.abandonDeleteAck === flags.abandonDeleteAck
  ) {
    return current;
  }
  return prisma.biometricConsent.create({
    data: {
      userId,
      documentVersion: LEGAL_DOC_VERSION,
      acceptedAt: new Date(),
      ...flags,
    },
  });
}

export async function withdrawBiometricConsent(userId: string) {
  await prisma.biometricConsent.updateMany({
    where: { userId, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });
}

export async function recordShareLikenessConsent(userId: string) {
  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      shareLikenessConsentAt: new Date(),
    },
    update: {
      shareLikenessConsentAt: new Date(),
    },
  });
}

export async function hasShareLikenessConsent(userId: string): Promise<boolean> {
  const row = await prisma.userProfile.findUnique({
    where: { userId },
    select: { shareLikenessConsentAt: true },
  });
  return Boolean(row?.shareLikenessConsentAt);
}
