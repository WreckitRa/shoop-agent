import { getAuthContext } from "@/lib/auth/session";
import { loadShareByToken } from "@/lib/ask/create-share";
import { buildLookAskPublic } from "@/lib/ask/public-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token || token.length > 32) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const share = await loadShareByToken(token);
  if (!share) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const auth = await getAuthContext();
  const viewerUserId = auth.ok ? auth.userId : null;
  const voterKey =
    req.headers.get("x-ask-voter-key")?.trim() ||
    (viewerUserId ? `user:${viewerUserId}` : null);

  const payload = buildLookAskPublic({
    share,
    viewerUserId,
    viewerVoterKey: voterKey,
  });

  return Response.json({ ok: true, share: payload });
}
