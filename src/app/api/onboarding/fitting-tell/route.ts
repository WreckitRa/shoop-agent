import { getAuthContext } from "@/lib/auth/session";
import { kickOnboardingJobWorker } from "@/lib/onboarding/background-jobs";
import {
  buildPatchFromFittingTell,
  deferredFeedback,
  extractFittingTell,
  filledLabels,
  prefillFromFittingTell,
  type FittingTellKnown,
} from "@/lib/onboarding/fitting-tell";
import { fittingTellPostSchema } from "@/lib/onboarding/request-schemas";
import {
  applyOnboardingPatch,
  getOnboardingStatus,
} from "@/lib/onboarding/status";
import { after } from "next/server";
import { enterFittingTraceFromRequest } from "@/lib/onboarding/fitting-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  enterFittingTraceFromRequest(req);
  try {
    const parsed = fittingTellPostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const known = (parsed.data.known ?? {}) as FittingTellKnown;
    const extraction = await extractFittingTell({
      text: parsed.data.text,
      known,
      signal: req.signal,
      audit: {
        userId: auth.userId,
        kind: "memory_extract",
        sequence: 0,
        metadata: { source: "fitting_mirror_tell" },
      },
    });

    if (!extraction) {
      return Response.json(
        { error: "Could not parse that — try again in a moment." },
        { status: 502 },
      );
    }

    const patch = buildPatchFromFittingTell(extraction, known);
    if (Object.keys(patch).length) {
      await applyOnboardingPatch(patch, auth.userId, {
        extraNotes: parsed.data.text.slice(0, 500),
        requestKey: crypto.randomUUID(),
      });
      after(kickOnboardingJobWorker);
    }

    const filled = filledLabels(extraction);
    const deferredNote = deferredFeedback(
      extraction,
      known.currentStep,
    );
    const status = await getOnboardingStatus(auth.userId);

    return Response.json({
      ok: true,
      summary: extraction.summary,
      filled,
      deferredNote,
      extraction,
      prefill: prefillFromFittingTell(extraction),
      ...status,
    });
  } catch {
    return Response.json(
      { error: "Could not understand that yet." },
      { status: 500 },
    );
  }
}
