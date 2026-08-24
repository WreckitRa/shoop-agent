import { prisma } from "@/lib/ai-chat/db";
import { isAtLeastAge } from "@/lib/onboarding/form-options";
import { MIN_ACCOUNT_AGE } from "./constants";
import { hasActiveBiometricConsent } from "./consents";

export type PhotoProcessGate =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

export async function assertPhotoProcessingAllowed(params: {
  userId: string;
  isGuest: boolean;
}): Promise<PhotoProcessGate> {
  if (params.isGuest) {
    return {
      ok: false,
      status: 401,
      error: "Create an account before uploading a photograph.",
    };
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: params.userId },
    select: { birthDate: true },
  });
  if (!profile?.birthDate || !isAtLeastAge(profile.birthDate, MIN_ACCOUNT_AGE)) {
    return {
      ok: false,
      status: 403,
      error: `We need your date of birth, and you must be at least ${MIN_ACCOUNT_AGE}, before any photograph is processed.`,
    };
  }

  if (!(await hasActiveBiometricConsent(params.userId))) {
    return {
      ok: false,
      status: 403,
      error: "Accept the biometric consent before uploading a photograph.",
    };
  }

  return { ok: true };
}
