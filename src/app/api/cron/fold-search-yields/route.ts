import { foldSearchQueryYields } from "@/lib/ai-chat/search/learning";

export const dynamic = "force-dynamic";

/**
 * Nightly fold of `SearchQueryYield` telemetry into per-(archetype,category)
 * learned query angles (docs/search-improvements.md §13). Schedule via the
 * platform cron (e.g. Railway/Vercel) hitting this route once a day.
 *
 * Auth: when `CRON_SECRET` is set, the caller must send a matching
 * `Authorization: Bearer <secret>` header (or `?secret=` query param).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    const url = new URL(request.url);
    const provided =
      auth.replace(/^Bearer\s+/i, "").trim() ||
      (url.searchParams.get("secret") ?? "");
    if (provided !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const folded = await foldSearchQueryYields();
  return Response.json({
    ok: true,
    foldedRows: folded.length,
    top: folded.slice(0, 25),
  });
}
