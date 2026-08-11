import { getAuthContext } from "@/lib/auth/session";
import { listMoodboardTryons } from "@/lib/tryon/generations";
import { enrichMoodboardItems } from "@/lib/tryon/moodboard-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json(
      { error: "Sign in to view your moodboard." },
      { status: 401 },
    );
  }

  try {
    const base = await listMoodboardTryons(auth.userId);
    const items = await enrichMoodboardItems(auth.userId, base);
    return Response.json({ ok: true, items });
  } catch {
    return Response.json(
      { error: "Could not load moodboard." },
      { status: 500 },
    );
  }
}
