import { z } from "zod";
import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  applyOnboardingPatch,
  onboardingPatchSchema,
} from "@/lib/onboarding/status";
import { kickOnboardingJobWorker } from "@/lib/onboarding/background-jobs";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z
  .object({
    patch: onboardingPatchSchema,
    extraNotes: z.string().max(24_000).optional(),
    requestKey: z.string().min(8).max(128),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = reviewSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid body.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const status = await applyOnboardingPatch(
      parsed.data.patch,
      auth.userId,
      {
        extraNotes: parsed.data.extraNotes,
        requestKey: parsed.data.requestKey,
      },
    );
    const selfPerson = await ensureSelfPerson(auth.userId)
      .then((person) => ({
        id: person.id,
        hasAvatar: Boolean(person.avatar),
      }))
      .catch(() => null);

    after(kickOnboardingJobWorker);
    return Response.json({ ...status, selfPerson });
  } catch {
    return Response.json(
      { error: "Could not save your onboarding profile." },
      { status: 500 },
    );
  }
}
