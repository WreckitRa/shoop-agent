import {
  applyOnboardingPatch,
  completeOnboarding,
  getOnboardingStatus,
  onboardingPatchSchema,
} from "@/lib/onboarding/status";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    return Response.json(await getOnboardingStatus(auth.userId));
  } catch {
    return Response.json({ error: "Could not load onboarding status." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const raw = await req.json();
    const parsed = onboardingPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }

    return Response.json(await applyOnboardingPatch(parsed.data, auth.userId));
  } catch {
    return Response.json({ error: "Could not save onboarding answers." }, { status: 500 });
  }
}

export async function POST() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const result = await completeOnboarding(auth.userId);
    if (!result.ok) {
      return Response.json(
        {
          error: "Required onboarding fields are missing.",
          ...result.status,
        },
        { status: 400 },
      );
    }

    return Response.json(result.status);
  } catch {
    return Response.json({ error: "Could not complete onboarding." }, { status: 500 });
  }
}
