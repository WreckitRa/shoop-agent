import { after } from "next/server";
import { trackProductEvent } from "@/lib/analytics/track";
import { getAuthContext } from "@/lib/auth/session";
import { hashPhoto } from "@/lib/photo-analysis/decode";
import { inspectPhotoBytes } from "@/lib/photo-analysis/inspect-photo";
import {
  PhotoUploadCapError,
  assertPhotoUploadCaps,
} from "@/lib/photo-analysis/upload-caps";
import {
  PHOTO_MODEL_COST_ESTIMATES,
  PhotoSpendCapError,
  assertPhotoModelSpend,
} from "@/lib/ops/spend-guard";
import { runPhotoAnalysis, runPhotoDetail, runPhotoPreflight } from "@/lib/photo-analysis/run";
import { bindFittingTraceFromRequest, enterFittingTraceFromRequest, logFitting } from "@/lib/onboarding/fitting-trace";
import { assertPhotoProcessingAllowed } from "@/lib/legal/photo-gate";
import { detectRequestArea } from "@/lib/server/request-area";
import {
  findByHash,
  findLatestAnalysis,
  saveReview,
  toPublic,
  upsertRunning,
  expireStaleRunningAnalysis,
  expireStaleRunningVerdict,
} from "@/lib/photo-analysis/store";
import { DEFAULT_TARGET_PERSON } from "@/lib/photo-analysis/types";
import { parseStyleUserReview } from "@/lib/photo-analysis/review";
import { parsePhotoCoverage, parseStylePhotoAnalysis, parseStylePhotoPreflight, facePhotoAccepted } from "@/lib/photo-analysis/result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

function wantsForce(req: Request, form: FormData): boolean {
  const url = new URL(req.url);
  if (url.searchParams.get("force") === "1") return true;
  const raw = form.get("force");
  return raw === "1" || raw === "true";
}

function formText(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function parseDeclaredContext(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  enterFittingTraceFromRequest(req);
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const hash = new URL(req.url).searchParams.get("hash")?.trim() ?? "";
  const row = hash
    ? await findByHash(auth.userId, hash)
    : await findLatestAnalysis(auth.userId);
  if (!row) return Response.json({ analysis: null });
  const next = await expireStaleRunningVerdict(
    await expireStaleRunningAnalysis(row),
  );
  logFitting("photo_analysis.poll", {
    hash: hash || null,
    status: next.status,
    verdictStatus: next.verdictStatus,
    error: next.error ?? null,
    verdictError: next.verdictError ?? null,
  });
  return Response.json({ analysis: toPublic(next) });
}

export async function POST(req: Request) {
  enterFittingTraceFromRequest(req);
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const gate = await assertPhotoProcessingAllowed({
    ...auth,
    countryCode: detectRequestArea(req.headers)?.countryCode,
  });
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: gate.status });
  }
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json({ error: "photo file required." }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "photo file required." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const inspected = inspectPhotoBytes(bytes);
  if (!inspected.ok) {
    return Response.json({ error: inspected.error }, { status: inspected.status });
  }

  try {
    await assertPhotoUploadCaps({ userId: auth.userId, req });
  } catch (error) {
    if (error instanceof PhotoUploadCapError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const photoHash = hashPhoto(bytes);
  const force = wantsForce(req, form);
  const targetPerson = formText(form, "target_person") || DEFAULT_TARGET_PERSON;
  const declaredContext = parseDeclaredContext(
    formText(form, "declared_context"),
  );
  const requestedCoverage = parsePhotoCoverage(
    formText(form, "requested_coverage"),
  );

  if (!force) {
    const existing = await findByHash(auth.userId, photoHash);
    const prevCoverage =
      parseStylePhotoPreflight(existing?.gate)?.requested_coverage ??
      parseStylePhotoAnalysis(existing?.result)?.analysis_status
        .requested_coverage;
    if (
      existing &&
      prevCoverage === requestedCoverage &&
      !existing.error &&
      (existing.result || facePhotoAccepted(parseStylePhotoPreflight(existing.gate)))
    ) {
      return Response.json({ analysis: toPublic(existing) });
    }
  }

  try {
    await assertPhotoModelSpend(
      PHOTO_MODEL_COST_ESTIMATES.preflight + PHOTO_MODEL_COST_ESTIMATES.analysis,
    );
  } catch (error) {
    if (error instanceof PhotoSpendCapError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const row = await upsertRunning(auth.userId, photoHash);
  logFitting("photo_analysis.upload", {
    hash: photoHash,
    bytes: bytes.length,
    force,
    targetPerson,
    requestedCoverage: requestedCoverage ?? null,
  });
  trackProductEvent({
    name: "photo_uploaded",
    userId: auth.userId,
    props: {
      photo_hash: photoHash,
      target_person: targetPerson,
      requested_coverage: requestedCoverage ?? null,
      force,
    },
  });
  const opts = {
    targetPerson,
    declaredContext,
    requestedCoverage,
  };
  if (force) {
    await runPhotoAnalysis(row.id, bytes, opts);
    const done = await findByHash(auth.userId, photoHash);
    return Response.json({ analysis: toPublic(done ?? row) });
  }

  const { accepted } = await runPhotoPreflight(row.id, bytes, opts);
  if (accepted) {
    after(bindFittingTraceFromRequest(req, () => runPhotoDetail(row.id, bytes, opts)));
  }
  const next = await findByHash(auth.userId, photoHash);
  return Response.json({ analysis: toPublic(next ?? row) });
}

export async function PATCH(req: Request) {
  enterFittingTraceFromRequest(req);
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as {
    hash?: unknown;
    review?: unknown;
  } | null;
  const hash = typeof body?.hash === "string" ? body.hash.trim() : "";
  if (!hash) {
    return Response.json({ error: "photo hash required." }, { status: 400 });
  }

  const row = await findByHash(auth.userId, hash);
  if (!row?.result) {
    return Response.json(
      { error: "Analyze the photo before reviewing it." },
      { status: 409 },
    );
  }

  const rawReview = body?.review;
  const review = parseStyleUserReview(
    rawReview && typeof rawReview === "object" && !Array.isArray(rawReview)
      ? { ...rawReview, submitted_at: new Date().toISOString() }
      : null,
  );
  if (!review) {
    return Response.json({ error: "Review is incomplete." }, { status: 400 });
  }

  await saveReview(row.id, review);
  const done = await findByHash(auth.userId, hash);
  return Response.json({ analysis: toPublic(done ?? row) });
}

