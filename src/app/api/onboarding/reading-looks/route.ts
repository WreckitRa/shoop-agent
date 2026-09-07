import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { findByHash, findLatestAnalysis } from "@/lib/photo-analysis/store";
import { loadLooksPublic, resolveLooksJob, looksJobRunning } from "@/lib/looks/job";
import {
  enterFittingTraceFromRequest,
  logFitting,
} from "@/lib/onboarding/fitting-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(req: Request) {
  enterFittingTraceFromRequest(req);
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const hashParam = new URL(req.url).searchParams.get("hash")?.trim() ?? "";
  const row = hashParam
    ? await findByHash(auth.userId, hashParam)
    : await findLatestAnalysis(auth.userId);
  const photoHash = row?.photoHash;
  if (!photoHash) {
    return Response.json({ looks: [], swatches: [], pending: false });
  }

  const { stuckQueued, needsResume, ...payload } = await loadLooksPublic(
    auth.userId,
    photoHash,
  );
  const verdictAge = row.updatedAt
    ? Date.now() - new Date(row.updatedAt).getTime()
    : 0;
  const seeding =
    payload.looks.length === 0 &&
    Boolean(row.verdict) &&
    verdictAge < 180_000;
  const shouldKick =
    !looksJobRunning(auth.userId, photoHash) &&
    (needsResume ||
      stuckQueued ||
      (payload.looks.length === 0 &&
        Boolean(row.verdict) &&
        verdictAge >= 90_000 &&
        verdictAge < 10 * 60_000));
  if (shouldKick) {
    after(() =>
      resolveLooksJob(auth.userId, photoHash).catch((err: unknown) => {
        logFitting("looks.job_failed", {
          error: err instanceof Error ? err.message : "looks job failed",
        });
      }),
    );
  }

  return Response.json({
    looks: payload.looks,
    swatches: payload.swatches,
    pending: payload.pending || seeding,
  });
}
