import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { findByHash, findLatestAnalysis } from "@/lib/photo-analysis/store";
import { retryLookRender } from "@/lib/looks/job";
import { queueLookRetry } from "@/lib/looks/store";
import {
  bindFittingTraceFromRequest,
  enterFittingTraceFromRequest,
  logFitting,
} from "@/lib/onboarding/fitting-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lookIndex: string }> },
) {
  enterFittingTraceFromRequest(req);
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const { lookIndex: raw } = await ctx.params;
  const lookIndex = Number(raw);
  if (!Number.isInteger(lookIndex) || lookIndex < 0) {
    return Response.json({ error: "Invalid look" }, { status: 400 });
  }
  const hash = new URL(req.url).searchParams.get("hash")?.trim() ?? "";
  const row = hash
    ? await findByHash(auth.userId, hash)
    : await findLatestAnalysis(auth.userId);
  if (!row?.photoHash) {
    return Response.json({ error: "No verdict" }, { status: 404 });
  }
  await queueLookRetry(auth.userId, row.photoHash, lookIndex);
  const run = bindFittingTraceFromRequest(req, async () => {
    try {
      await retryLookRender({
        userId: auth.userId,
        photoHash: row.photoHash,
        lookIndex,
      });
    } catch (err) {
      logFitting("looks.retry_failed", {
        lookIndex,
        error: err instanceof Error ? err.message : "retry failed",
      });
    }
  });
  after(run);
  return Response.json({ ok: true, pending: true });
}
