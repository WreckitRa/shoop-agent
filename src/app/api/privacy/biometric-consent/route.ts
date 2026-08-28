import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import {
  hasActiveBiometricConsent,
  latestBiometricConsent,
  recordBiometricConsent,
} from "@/lib/legal/consents";
import { withdrawBiometricAndLog } from "@/lib/legal/close-account";
import { hasBiometricResidue } from "@/lib/legal/purge";
import { LEGAL_DOC_VERSION } from "@/lib/legal/constants";
import { decideSignupRegion } from "@/lib/legal/geo-gate";
import { guestPhotoConsentSatisfied } from "@/lib/legal/photo-consent";
import { detectRequestArea } from "@/lib/server/request-area";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    action: z.enum(["accept", "withdraw"]),
    ageAttested: z.boolean().optional(),
    ownPhotoAttested: z.boolean().optional(),
    abandonDeleteAck: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const row = await latestBiometricConsent(auth.userId);
  const accepted = auth.isGuest
    ? guestPhotoConsentSatisfied(row)
    : await hasActiveBiometricConsent(auth.userId);
  return Response.json({
    accepted,
    needsReconsent: !accepted && (await hasBiometricResidue(auth.userId)),
    documentVersion: row?.documentVersion ?? null,
    acceptedAt: row?.acceptedAt?.toISOString() ?? null,
    withdrawnAt: row?.withdrawnAt?.toISOString() ?? null,
    currentDocumentVersion: LEGAL_DOC_VERSION,
  });
}

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (parsed.data.action === "accept") {
    if (auth.isGuest) {
      const region = decideSignupRegion(
        detectRequestArea(req.headers)?.countryCode,
      );
      if (!region.ok) {
        return Response.json({ error: region.reason }, { status: 403 });
      }
      if (
        !parsed.data.ageAttested ||
        !parsed.data.ownPhotoAttested ||
        !parsed.data.abandonDeleteAck
      ) {
        return Response.json(
          { error: "All three confirmations are required." },
          { status: 400 },
        );
      }
    }

    const row = await recordBiometricConsent(auth.userId, {
      ageAttested: Boolean(parsed.data.ageAttested),
      ownPhotoAttested: Boolean(parsed.data.ownPhotoAttested),
      abandonDeleteAck: Boolean(parsed.data.abandonDeleteAck),
    });
    return Response.json({
      ok: true,
      accepted: true,
      documentVersion: row.documentVersion,
      acceptedAt: row.acceptedAt.toISOString(),
    });
  }

  await withdrawBiometricAndLog(auth.userId);
  return Response.json({ ok: true, accepted: false, withdrawn: true });
}
