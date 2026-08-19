import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { PHOTO_MAX_BYTES, hashPhoto } from "@/lib/photo-analysis/decode";
import { runPhotoAnalysis } from "@/lib/photo-analysis/run";
import {
  findByHash,
  findLatestAnalysis,
  toPublic,
  upsertRunning,
} from "@/lib/photo-analysis/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function bothReady(row: { specStatus: string; gptStatus: string }): boolean {
  return row.specStatus === "ready" && row.gptStatus === "ready";
}

function stillRunning(row: { specStatus: string; gptStatus: string }): boolean {
  return row.specStatus === "pending" || row.gptStatus === "pending";
}

function wantsForce(req: Request, form: FormData): boolean {
  const url = new URL(req.url);
  if (url.searchParams.get("force") === "1") return true;
  const raw = form.get("force");
  return raw === "1" || raw === "true";
}

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const row = await findLatestAnalysis(auth.userId);
  if (!row) return Response.json({ analysis: null });
  return Response.json({ analysis: toPublic(row) });
}

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

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

  if (!force) {
    const existing = await findByHash(auth.userId, photoHash);
    if (existing && bothReady(existing)) {
      return Response.json({ analysis: toPublic(existing) });
    }
    if (existing && stillRunning(existing)) {
      return Response.json({ analysis: toPublic(existing) });
    }
  }

  const row = await upsertRunning(auth.userId, photoHash);
  if (force) {
    await runPhotoAnalysis(row.id, bytes);
    const done = await findByHash(auth.userId, photoHash);
    return Response.json({ analysis: toPublic(done ?? row) });
  }

  after(() => runPhotoAnalysis(row.id, bytes));
  return Response.json({ analysis: toPublic(row) });
}
