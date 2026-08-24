import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import { MIN_ACCOUNT_AGE } from "./constants";
import { recordPrivacyDeletion, type PrivacyDeletionKind } from "./deletion-log";
import { deleteAllUserData, purgeBiometricData } from "./purge";
import { isAtLeastAge } from "@/lib/onboarding/form-options";
import { parseIsoBirthDate } from "./age-gate";

export class MinorAccountClosedError extends Error {
  readonly closed = true as const;
  constructor() {
    super(
      `This account was closed because the date of birth is under ${MIN_ACCOUNT_AGE}.`,
    );
    this.name = "MinorAccountClosedError";
  }
}

export function minorClosedResponse(error: unknown): Response | null {
  if (!(error instanceof MinorAccountClosedError)) return null;
  return Response.json(
    { error: error.message, closed: true },
    { status: 403 },
  );
}

export async function closeAndPurgeUser(params: {
  userId: string;
  kind: PrivacyDeletionKind;
  deleteAuthUser?: boolean;
  details?: Record<string, unknown>;
}): Promise<void> {
  await deleteAllUserData(params.userId);
  await recordPrivacyDeletion({
    userId: params.userId,
    kind: params.kind,
    details: params.details,
  });
  if (!params.deleteAuthUser || !isSupabaseAuthConfigured()) return;
  const { error } = await getSupabaseAdminClient().auth.admin.deleteUser(
    params.userId,
  );
  if (error) throw new Error(error.message);
}

export async function withdrawBiometricAndLog(userId: string): Promise<void> {
  await purgeBiometricData(userId);
  await recordPrivacyDeletion({ userId, kind: "biometric_withdraw" });
}

/** If the DOB is under the threshold, close the account. Returns true when closed. */
export async function closeIfUnderageBirthDate(
  userId: string,
  raw: string | Date,
): Promise<boolean> {
  const iso =
    raw instanceof Date
      ? raw.toISOString().slice(0, 10)
      : parseIsoBirthDate(raw);
  if (!iso) return false;
  if (isAtLeastAge(iso, MIN_ACCOUNT_AGE)) return false;
  await closeAndPurgeUser({
    userId,
    kind: "minor",
    deleteAuthUser: true,
    details: { reason: "underage" },
  });
  return true;
}
