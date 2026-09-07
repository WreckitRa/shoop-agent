import { getAuthContext } from "@/lib/auth/session";
import { listRecentCompletedTryons } from "@/lib/tryon/generations";
import { moodboardDisplayTitle } from "@/lib/tryon/moodboard-title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent completed try-ons for Ask Friends comparative challenger pick. */
export async function GET(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const url = new URL(req.url);
  const exclude = url.searchParams.get("exclude")?.trim() || null;
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 12) || 12, 1),
    24,
  );

  try {
    const rows = await listRecentCompletedTryons(auth.userId, {
      excludeId: exclude,
      limit,
    });
    return Response.json({
      ok: true,
      items: rows.map((row) => {
        const kind = row.kind === "outfit" ? "look" : "item";
        return {
          generationId: row.id,
          imageUrl: `/api/tryon/image/${row.id}`,
          title: moodboardDisplayTitle({
            kind,
            lookId: row.lookId,
            inputRefs: row.inputRefs,
          }),
          kind,
        };
      }),
    });
  } catch {
    return Response.json(
      { error: "Could not load recent looks." },
      { status: 500 },
    );
  }
}
