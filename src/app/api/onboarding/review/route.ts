import { after } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { applyOnboardingPatch } from "@/lib/onboarding/status";
import { reviewPostSchema } from "@/lib/onboarding/request-schemas";
import { kickOnboardingJobWorker } from "@/lib/onboarding/background-jobs";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";
import { fashionOwnerUserId } from "@/lib/fashion-memory/auth";
import { minorClosedResponse } from "@/lib/legal/close-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = reviewPostSchema.safeParse(raw);
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
    const ownerId = fashionOwnerUserId(auth.userId);
    const selfPerson = ownerId
      ? await ensureSelfPerson(ownerId)
          .then((person) => ({
            id: person.id,
            hasAvatar: Boolean(person.avatar),
          }))
          .catch(() => null)
      : null;

    after(kickOnboardingJobWorker);
    return Response.json({ ...status, selfPerson });
  } catch (error) {
    const closed = minorClosedResponse(error);
    if (closed) return closed;
    return Response.json(
      { error: "Could not save your onboarding profile." },
      { status: 500 },
    );
  }
}
