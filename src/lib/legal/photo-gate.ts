import { prisma } from "@/lib/ai-chat/db";
import { isAtLeastAge } from "@/lib/onboarding/form-options";
import { MIN_ACCOUNT_AGE } from "./constants";
import { hasActiveBiometricConsent, latestBiometricConsent } from "./consents";
import { decideSignupRegion } from "./geo-gate";
import { guestPhotoConsentSatisfied } from "./photo-consent";

export type PhotoProcessGate =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/** Signup checkbox or a stored birthday that is at least 13. Underage DOB always fails. */
export function signedInPhotoAgeOk(profile: {
  birthDate: Date | string | null | undefined;
  ageAttestedAt: Date | string | null | undefined;
}): boolean {
  if (profile.birthDate && !isAtLeastAge(profile.birthDate, MIN_ACCOUNT_AGE)) {
    return false;
  }
  if (profile.ageAttestedAt) return true;
  return Boolean(
    profile.birthDate && isAtLeastAge(profile.birthDate, MIN_ACCOUNT_AGE),
  );
}

export async function assertPhotoProcessingAllowed(params: {
  userId: string;
  isGuest: boolean;
  countryCode?: string | null;
}): Promise<PhotoProcessGate> {
  if (params.isGuest) {
    const region = decideSignupRegion(params.countryCode);
    if (!region.ok) {
      return { ok: false, status: 403, error: region.reason };
    }
    const row = await latestBiometricConsent(params.userId);
    if (!guestPhotoConsentSatisfied(row)) {
      return {
        ok: false,
        status: 403,
        error:
          "Confirm you are at least 13, that the photo is of you, and that we may delete it if you leave without saving — then accept measurement.",
      };
    }
    return { ok: true };
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: params.userId },
    select: { birthDate: true, ageAttestedAt: true },
  });
  if (!signedInPhotoAgeOk({
    birthDate: profile?.birthDate ?? null,
    ageAttestedAt: profile?.ageAttestedAt ?? null,
  })) {
    return {
      ok: false,
      status: 403,
      error: `Confirm you are at least ${MIN_ACCOUNT_AGE} before any photograph is processed.`,
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
