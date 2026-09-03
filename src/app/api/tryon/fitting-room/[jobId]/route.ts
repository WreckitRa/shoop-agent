import { getAuthContext } from "@/lib/auth/session";
import { pollOutfitTryon } from "@/lib/tryon/run-outfit";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";
import { logVerdict } from "@/lib/photo-analysis/verdict-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loggedDressJobs = new Set<string>();

export async function GET(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const owner = await requireAvatarOwner(req, auth, { photoGate: false });
  if (!owner.ok) return owner.response;
  const { jobId } = await ctx.params;
  const fromVerdict = new URL(req.url).searchParams.get("source") === "verdict";
  try {
    const tryon_look = await pollOutfitTryon({ jobId, userId: owner.userId });
    const status = tryon_look?.status;
    if (
      fromVerdict &&
      (status === "completed" || status === "failed")
    ) {
      const key = `${jobId}:${status}`;
      if (!loggedDressJobs.has(key)) {
        loggedDressJobs.add(key);
        logVerdict("dress-result", {
          jobId,
          status,
          image: Boolean(tryon_look?.final_image_url),
        });
      }
    }
    return Response.json({ ok: true, tryon_look });
  } catch {
    if (fromVerdict) logVerdict("dress-result", { jobId, status: "missing" });
    return Response.json({ error: "Job not found." }, { status: 404 });
  }
}
