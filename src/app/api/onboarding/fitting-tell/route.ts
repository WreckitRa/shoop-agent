import { z } from "zod";
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
import {
  applyOnboardingPatch,
  getOnboardingStatus,
} from "@/lib/onboarding/status";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    text: z.string().min(1).max(2000),
      known: z
      .object({
        preferredName: z.string().max(120).optional(),
        genderPresentation: z.string().max(40).optional(),
        styleEras: z.array(z.string().max(40)).max(8).optional(),
        budgetPhilosophies: z.array(z.string().max(40)).max(8).optional(),
        brandLikes: z.array(z.string().max(60)).max(20).optional(),
        brandAvoids: z.array(z.string().max(60)).max(20).optional(),
        hardAvoids: z.array(z.string().max(80)).max(20).optional(),
        comfort: z.array(z.string().max(80)).max(16).optional(),
        weekIs: z.string().max(40).optional(),
        dressingFor: z.string().max(40).optional(),
        kids: z.string().max(20).optional(),
        climate: z.string().max(40).optional(),
        honestyPreference: z.string().max(40).optional(),
        styleFriction: z.string().max(2000).optional(),
        styleBecome: z.string().max(2000).optional(),
        circleNames: z.array(z.string().max(40)).max(3).optional(),
        heightCm: z.number().int().min(50).max(280).nullable().optional(),
        weightKg: z.number().int().min(20).max(400).nullable().optional(),
        build: z.string().max(40).nullable().optional(),
        currentStep: z
          .enum([
            "photo",
            "name",
            "life",
            "spend",
            "fit",
            "worn",
            "corner",
            "wanted",
            "nolist",
            "honesty",
            "circle",
            "verdict",
          ])
          .optional(),
      })
      .optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

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
