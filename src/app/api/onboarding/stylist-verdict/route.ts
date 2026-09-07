import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  PHOTO_MODEL_COST_ESTIMATES,
  PhotoSpendCapError,
  assertPhotoModelSpend,
} from "@/lib/ops/spend-guard";
import { PHOTO_MAX_BYTES } from "@/lib/photo-analysis/decode";
import { assembleVerdictInput } from "@/lib/photo-analysis/verdict-input";
import { parseConfirmedBody } from "@/lib/photo-analysis/review";
import {
  generateStylistVerdict,
  hashedSafetyIdentifier,
  stylistVerdictModel,
} from "@/lib/photo-analysis/verdict";
import {
  ensureVerdictAnchor,
  expireStaleRunningVerdict,
  findByHash,
  NOPHOTO_HASH,
  saveVerdict,
  saveVerdictError,
  saveVerdictRunning,
  toPublic,
} from "@/lib/photo-analysis/store";
import { bindFittingTraceFromRequest, enterFittingTraceFromRequest, logFitting } from "@/lib/onboarding/fitting-trace";
import { startPhotoJobHeartbeat } from "@/lib/photo-analysis/job-heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

async function readVerdictRequest(req: Request): Promise<{
  hash: string;
  declaredBody: unknown;
  photoBytes: Buffer | null;
}> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const hashRaw = form.get("hash");
    const hash = typeof hashRaw === "string" ? hashRaw.trim() : "";
    const declaredRaw = form.get("declared_body");
    let declaredBody: unknown = null;
    if (typeof declaredRaw === "string" && declaredRaw.trim()) {
      try {
        declaredBody = JSON.parse(declaredRaw) as unknown;
      } catch {
        declaredBody = null;
      }
    }
    const photo = form.get("photo");
    let photoBytes: Buffer | null = null;
    if (photo instanceof Blob && photo.size > 0 && photo.size <= PHOTO_MAX_BYTES) {
      photoBytes = Buffer.from(await photo.arrayBuffer());
    }
    return { hash, declaredBody, photoBytes };
  }

  const body = (await req.json().catch(() => null)) as {
    hash?: unknown;
    declared_body?: unknown;
    photo?: unknown;
  } | null;
  const hash = typeof body?.hash === "string" ? body.hash.trim() : "";
  let photoBytes: Buffer | null = null;
  if (typeof body?.photo === "string" && body.photo.startsWith("data:image/")) {
    const comma = body.photo.indexOf(",");
    if (comma > 0) {
      const buf = Buffer.from(body.photo.slice(comma + 1), "base64");
      if (buf.length > 0 && buf.length <= PHOTO_MAX_BYTES) photoBytes = buf;
    }
  }
  return { hash, declaredBody: body?.declared_body ?? null, photoBytes };
}

export async function POST(req: Request) {
  enterFittingTraceFromRequest(req);
  try {
    return await postVerdict(req);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Stylist verdict failed";
    logFitting("verdict.kick_failed", { error: message });
    return Response.json(
      { error: "Couldn’t write the verdict." },
      { status: 500 },
    );
  }
}

async function postVerdict(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const parsed = await readVerdictRequest(req);
  const hash = parsed.hash || NOPHOTO_HASH;
  const extraBody = parseConfirmedBody(parsed.declaredBody);

  let assembled = await assembleVerdictInput(auth.userId, hash, extraBody);
  if (assembled.missing.length) {
    logFitting("verdict.kick_blocked", {
      hash,
      missing: assembled.missing,
    });
    return Response.json(
      {
        error: "Still missing details the stylist needs.",
        missing: assembled.missing,
      },
      { status: 409 },
    );
  }

  const row = await expireStaleRunningVerdict(
    assembled.row ?? (await ensureVerdictAnchor(auth.userId, hash)),
  );
  if (!assembled.row) {
    assembled = { ...assembled, row };
  }
  if (
    row.verdictStatus === "running" ||
    (row.verdictStatus === "done" && row.verdict)
  ) {
    logFitting("verdict.kick_reuse", {
      hash,
      verdictStatus: row.verdictStatus,
    });
    return Response.json({ analysis: toPublic(row) });
  }

  try {
    await assertPhotoModelSpend(PHOTO_MODEL_COST_ESTIMATES.verdict);
  } catch (error) {
    if (error instanceof PhotoSpendCapError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await saveVerdictRunning(row.id);
  logFitting("verdict.kick", {
    hash,
    hasPhoto: Boolean(parsed.photoBytes),
    model: stylistVerdictModel(),
  });
  const rowId = row.id;
  const model = stylistVerdictModel();
  const safetyIdentifier = hashedSafetyIdentifier(auth.userId);
  const photoAnalysis = (assembled.analysis ?? {}) as unknown as Record<
    string,
    unknown
  >;
  const userReview = (assembled.review ?? {}) as Record<string, unknown>;
  const questionnaireAnswers = assembled.questionnaireAnswers;
  const wardrobeInventory = assembled.wardrobeInventory;
  const applicationContext = assembled.applicationContext;
  const photoBytes = parsed.photoBytes;

  after(
    bindFittingTraceFromRequest(req, async () => {
      const started = Date.now();
      const stopBeat = startPhotoJobHeartbeat(rowId, "verdict");
      try {
        const { verdict, tokens } = await generateStylistVerdict({
          photoAnalysis,
          userReview,
          questionnaireAnswers,
          measurements: assembled.measurements,
          wardrobeInventory,
          applicationContext,
          safetyIdentifier,
          hasPhoto: Boolean(photoBytes),
        });
        await saveVerdict(rowId, verdict, Date.now() - started, model, tokens);
        logFitting("verdict.saved", {
          ms: Date.now() - started,
          model,
          tokens,
          verdict,
        });
        try {
          const { resolveLooksJob } = await import("@/lib/looks/job");
          await resolveLooksJob(auth.userId, hash);
        } catch (looksError) {
          logFitting("looks.job_failed", {
            error:
              looksError instanceof Error ? looksError.message : "looks job failed",
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Stylist verdict failed";
        logFitting("verdict.failed", {
          ms: Date.now() - started,
          model,
          error: message,
        });
        await saveVerdictError(rowId, message, Date.now() - started, model);
      } finally {
        stopBeat();
      }
    }),
  );

  const running = await findByHash(auth.userId, hash);
  return Response.json({ analysis: toPublic(running ?? row) });
}
