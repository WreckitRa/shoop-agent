import { getAuthContext } from "@/lib/auth/session";
import { circlePostSchema } from "@/lib/onboarding/request-schemas";
import {
  normalizeCircleNames,
  saveTrustedCirclePeople,
} from "@/lib/onboarding/trusted-circle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    if (auth.isGuest) {
      return Response.json(
        { error: "Sign in to save your trusted circle." },
        { status: 401 },
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = circlePostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid body.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const names = normalizeCircleNames(parsed.data.names);
    const result = await saveTrustedCirclePeople({
      userId: auth.userId,
      names,
    });

    return Response.json(result);
  } catch {
    return Response.json(
      { error: "Could not save your trusted circle." },
      { status: 500 },
    );
  }
}
