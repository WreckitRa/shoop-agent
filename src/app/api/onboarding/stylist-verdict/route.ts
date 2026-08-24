import { getAuthContext } from "@/lib/auth/session";
import { assembleVerdictInput } from "@/lib/photo-analysis/verdict-input";
import {
  generateStylistVerdict,
  hashedSafetyIdentifier,
  stylistVerdictModel,
} from "@/lib/photo-analysis/verdict";
import {
  findByHash,
  saveVerdict,
  saveVerdictError,
  saveVerdictRunning,
  toPublic,
} from "@/lib/photo-analysis/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as { hash?: unknown } | null;
  const hash = typeof body?.hash === "string" ? body.hash.trim() : "";
  if (!hash) {
    return Response.json({ error: "photo hash required." }, { status: 400 });
  }

  const assembled = await assembleVerdictInput(auth.userId, hash);
  if (!assembled.row || !assembled.analysis || !assembled.review) {
    return Response.json(
      {
        error: "Photo analysis and your review must be saved first.",
        missing: assembled.missing,
      },
      { status: 409 },
    );
  }
  if (assembled.missing.length) {
    return Response.json(
      {
        error: "Still missing details the stylist needs.",
        missing: assembled.missing,
      },
      { status: 409 },
    );
  }

  await saveVerdictRunning(assembled.row.id);
  const started = Date.now();
  const model = stylistVerdictModel();
  try {
    const verdict = await generateStylistVerdict({
      photoAnalysis: assembled.analysis as unknown as Record<string, unknown>,
      userReview: assembled.review,
      questionnaireAnswers: assembled.questionnaireAnswers,
      measurements: assembled.measurements,
      wardrobeInventory: assembled.wardrobeInventory,
      applicationContext: assembled.applicationContext,
      safetyIdentifier: hashedSafetyIdentifier(auth.userId),
    });
    await saveVerdict(assembled.row.id, verdict, Date.now() - started, model);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Stylist verdict failed";
    await saveVerdictError(
      assembled.row.id,
      message,
      Date.now() - started,
      model,
    );
  }

  const done = await findByHash(auth.userId, hash);
  return Response.json({ analysis: toPublic(done ?? assembled.row) });
}
