import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  PHOTO_MODEL_COST_ESTIMATES,
  PhotoSpendCapError,
  assertPhotoModelSpend,
} from "@/lib/ops/spend-guard";
import { assembleVerdictInput } from "@/lib/photo-analysis/verdict-input";
import { parseConfirmedBody } from "@/lib/photo-analysis/review";
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
  expireStaleRunningVerdict,
} from "@/lib/photo-analysis/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as {
    hash?: unknown;
    declared_body?: unknown;
  } | null;
  const hash = typeof body?.hash === "string" ? body.hash.trim() : "";
  if (!hash) {
    return Response.json({ error: "photo hash required." }, { status: 400 });
  }

  const extraBody = parseConfirmedBody(body?.declared_body);
  const assembled = await assembleVerdictInput(auth.userId, hash, extraBody);
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

  const row = await expireStaleRunningVerdict(assembled.row);
  if (
    row.verdictStatus === "running" ||
    (row.verdictStatus === "done" && row.verdict)
  ) {
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

  await saveVerdictRunning(assembled.row.id);
  const rowId = assembled.row.id;
  const model = stylistVerdictModel();
  const safetyIdentifier = hashedSafetyIdentifier(auth.userId);
  const photoAnalysis = assembled.analysis as unknown as Record<string, unknown>;
  const userReview = assembled.review;
  const questionnaireAnswers = assembled.questionnaireAnswers;
  const wardrobeInventory = assembled.wardrobeInventory;
  const applicationContext = assembled.applicationContext;

  after(async () => {
    const started = Date.now();
    try {
      const { verdict, tokens } = await generateStylistVerdict({
        photoAnalysis,
        userReview,
        questionnaireAnswers,
        measurements: assembled.measurements,
        wardrobeInventory,
        applicationContext,
        safetyIdentifier,
      });
      await saveVerdict(rowId, verdict, Date.now() - started, model, tokens);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Stylist verdict failed";
      await saveVerdictError(rowId, message, Date.now() - started, model);
    }
  });

  const running = await findByHash(auth.userId, hash);
  return Response.json({ analysis: toPublic(running ?? assembled.row) });
}
