import { getAuthContext } from "@/lib/auth/session";
import {
  enterFittingTrace,
  fittingTraceIdFromRequest,
  logFitting,
  readFittingTrace,
  readLatestFittingTraceId,
} from "@/lib/onboarding/fitting-trace";
import {
  isFittingTraceId,
  isFittingTracePublicEnabled,
  sanitizeFittingTraceValue,
} from "@/lib/onboarding/fitting-trace-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tracingAllowed(req: Request): boolean {
  if (isFittingTracePublicEnabled()) return true;
  const raw = process.env.FITTING_TRACE?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return Boolean(fittingTraceIdFromRequest(req));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

export async function GET(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (!tracingAllowed(req)) {
    return Response.json({ error: "Fitting trace is off." }, { status: 404 });
  }

  const id =
    new URL(req.url).searchParams.get("id")?.trim() ||
    readLatestFittingTraceId();
  if (!id || !isFittingTraceId(id)) {
    return Response.json({ error: "No fitting trace yet." }, { status: 404 });
  }
  const dump = readFittingTrace(id);
  if (!dump) {
    return Response.json({ error: "Unknown fitting trace." }, { status: 404 });
  }
  return Response.json(dump);
}

export async function POST(req: Request) {
  enterFittingTrace(fittingTraceIdFromRequest(req));
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (!tracingAllowed(req)) {
    return Response.json({ ok: true, ignored: true });
  }

  const headerId = fittingTraceIdFromRequest(req);
  if (!headerId) {
    return Response.json({ error: "trace id required." }, { status: 400 });
  }
  enterFittingTrace(headerId);

  const body = (await req.json().catch(() => null)) as {
    events?: unknown;
  } | null;
  const rawEvents = Array.isArray(body?.events) ? body.events : [];

  for (const item of rawEvents.slice(0, 40)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const event = typeof row.event === "string" ? row.event.trim() : "";
    if (!event) continue;
    const { event: _e, t: clientT, ...payload } = row;
    logFitting(event.startsWith("client.") ? event : `client.${event}`, {
      ...(typeof clientT === "string" ? { client_t: clientT } : {}),
      ...asRecord(sanitizeFittingTraceValue(payload)),
    });
  }
  return Response.json({ ok: true });
}
