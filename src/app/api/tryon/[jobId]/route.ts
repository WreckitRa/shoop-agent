import { getAuthContext } from "@/lib/auth/session";
import { pollSingleTryon } from "@/lib/tryon/run-single";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const { jobId } = await ctx.params;
  try {
    const result = await pollSingleTryon({ jobId, userId: auth.userId });
    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }
}
