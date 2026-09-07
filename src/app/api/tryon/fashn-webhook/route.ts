import { resolveFashnWebhook } from "@/lib/looks/fashn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false }, { status: 400 });
  }
  const creditsRaw = req.headers.get("x-fashn-credits-used");
  const credits = creditsRaw ? Number(creditsRaw) : 0;
  resolveFashnWebhook({
    id: typeof body.id === "string" ? body.id : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    output: body.output,
    error: body.error,
    credits: Number.isFinite(credits) ? credits : 0,
  });
  return Response.json({ ok: true });
}
