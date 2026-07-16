import { getAuthContext } from "@/lib/auth/session";
import { pollAvatarCompare } from "@/lib/tryon/avatar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const { jobId } = await ctx.params;
  const personId = new URL(req.url).searchParams.get("person_id");
  if (!personId) {
    return Response.json({ error: "person_id required." }, { status: 400 });
  }

  try {
    const result = await pollAvatarCompare({
      jobId,
      userId: auth.userId,
      personId,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
