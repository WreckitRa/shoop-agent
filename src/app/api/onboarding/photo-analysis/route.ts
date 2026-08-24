import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { PHOTO_MAX_BYTES, hashPhoto } from "@/lib/photo-analysis/decode";
import { runPhotoAnalysis } from "@/lib/photo-analysis/run";
import { assertPhotoProcessingAllowed } from "@/lib/legal/photo-gate";
import {
  findByHash,
  findLatestAnalysis,
  saveReview,
  toPublic,
  upsertRunning,
} from "@/lib/photo-analysis/store";
import { DEFAULT_TARGET_PERSON } from "@/lib/photo-analysis/types";
import { parseStyleUserReview } from "@/lib/photo-analysis/review";
import {
  parsePhotoCoverage,
  parseStylePhotoAnalysis,
  parseStylePhotoPreflight,
} from "@/lib/photo-analysis/result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const hash = new URL(req.url).searchParams.get("hash")?.trim() ?? "";
  const row = hash
    ? await findByHash(auth.userId, hash)
    : await findLatestAnalysis(auth.userId);
  if (!row) return Response.json({ analysis: null });
  return Response.json({ analysis: toPublic(row) });
}

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const gate = await assertPhotoProcessingAllowed(auth);
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
  if (file.size > PHOTO_MAX_BYTES) {
    return Response.json({ error: "Photo is too large." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) {
    return Response.json({ error: "Empty photo." }, { status: 400 });
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
    if (existing && prevCoverage === requestedCoverage) {
      return Response.json({ analysis: toPublic(existing) });
    }
  }

  const row = await upsertRunning(auth.userId, photoHash);
  const run = () =>
    runPhotoAnalysis(row.id, bytes, {
      targetPerson,
      declaredContext,
      requestedCoverage,
    });
  if (force) {
    await run();
    const done = await findByHash(auth.userId, photoHash);
    return Response.json({ analysis: toPublic(done ?? row) });
  }

  after(run);
  return Response.json({ analysis: toPublic(row) });
}

export async function PATCH(req: Request) {
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

