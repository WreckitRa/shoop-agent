import { getAuthContext } from "@/lib/auth/session";
import { logVerdict } from "@/lib/photo-analysis/verdict-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS = new Set([
  "looks-fetch",
  "looks-fetch-ok",
  "looks-fetch-cancelled",
  "looks-poll",
  "dress-wait",
  "dress-skip",
  "dress-pending",
  "dress-cancelled",
  "dress-done",
  "dress-fail",
]);

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const event = typeof body.event === "string" ? body.event : "";
  if (!EVENTS.has(event)) return Response.json({ ok: false }, { status: 400 });
  const { event: _e, ...payload } = body;
  logVerdict(event, payload);
  return Response.json({ ok: true });
}
