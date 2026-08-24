import { destroyInactiveBiometricData, destroySourcePhotosPastRetention } from "@/lib/legal/retention";

/**
 * Scheduled privacy deletions. Point the same worker/cron as
 * `/api/cron/onboarding-jobs` at this route (Bearer CRON_SECRET).
 * Deletes source photos past 24h and biometric data past 3 years inactivity.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    const provided = auth.replace(/^Bearer\s+/i, "").trim();
    if (provided !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const photos = await destroySourcePhotosPastRetention();
  const biometric = await destroyInactiveBiometricData();
  return Response.json({ ok: true, photos, biometric });
}
