import { getAuthContext } from "@/lib/auth/session";
import { pollOutfitTryon } from "@/lib/tryon/run-outfit";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const owner = await requireAvatarOwner(req, auth, { photoGate: false });
  if (!owner.ok) return owner.response;
  const { jobId } = await ctx.params;
  try {
    const tryon_look = await pollOutfitTryon({ jobId, userId: owner.userId });
    return Response.json({ ok: true, tryon_look });
  } catch {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }
}
