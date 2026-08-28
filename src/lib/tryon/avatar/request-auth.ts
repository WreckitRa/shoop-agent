import { fashionOwnerUserId } from "@/lib/fashion-memory/auth";
import { assertPhotoProcessingAllowed } from "@/lib/legal/photo-gate";
import { detectRequestArea } from "@/lib/server/request-area";

/** Map guest-`{uuid}` (and auth uuids) onto people / avatar / try-on columns. */
export async function requireAvatarOwner(
  req: Request,
  auth: { userId: string; isGuest: boolean },
  opts?: { photoGate?: boolean },
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const userId = fashionOwnerUserId(auth.userId);
  if (!userId) {
    return {
      ok: false,
      response: Response.json({ error: "Sign in required." }, { status: 401 }),
    };
  }
  if (opts?.photoGate === false) return { ok: true, userId };

  const gate = await assertPhotoProcessingAllowed({
    ...auth,
    countryCode: detectRequestArea(req.headers)?.countryCode,
  });
  if (!gate.ok) {
    return {
      ok: false,
      response: Response.json({ error: gate.error }, { status: gate.status }),
    };
  }
  return { ok: true, userId };
}
