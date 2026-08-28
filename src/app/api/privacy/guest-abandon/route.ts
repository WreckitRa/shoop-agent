import { getAuthContext } from "@/lib/auth/session";
import { purgeBiometricData } from "@/lib/legal/purge";
import { recordPrivacyDeletion } from "@/lib/legal/deletion-log";

export const dynamic = "force-dynamic";

/** Guest left without claiming an account — drop photograph and measurements. */
export async function POST() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (!auth.isGuest) return Response.json({ ok: true, skipped: true });

  await purgeBiometricData(auth.userId);
  await recordPrivacyDeletion({
    userId: auth.userId,
    kind: "biometric_withdraw",
    details: { reason: "guest_left_without_signup" },
  });
  return Response.json({ ok: true });
}
