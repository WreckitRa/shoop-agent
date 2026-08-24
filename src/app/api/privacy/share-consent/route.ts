import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { recordShareLikenessConsent } from "@/lib/legal/consents";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    shareLikenessConsent: z.literal(true),
  })
  .strict();

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Consent is required." }, { status: 400 });
  }
  await recordShareLikenessConsent(auth.userId);
  return Response.json({ ok: true });
}
