import { getAuthContext } from "@/lib/auth/session";
import { pollAvatarCompare } from "@/lib/tryon/avatar/service";
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
  const personId = new URL(req.url).searchParams.get("person_id");
  if (!personId) {
    return Response.json({ error: "person_id required." }, { status: 400 });
  }

  try {
    const result = await pollAvatarCompare({
      jobId,
      userId: owner.userId,
      personId,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
