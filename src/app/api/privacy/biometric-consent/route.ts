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

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    action: z.enum(["accept", "withdraw"]),
  })
  .strict();

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const row = await latestBiometricConsent(auth.userId);
  const accepted = await hasActiveBiometricConsent(auth.userId);
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
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (parsed.data.action === "accept") {
    const row = await recordBiometricConsent(auth.userId);
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
