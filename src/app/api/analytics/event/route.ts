import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { isProductEventName } from "@/lib/analytics/names";
import { trackProductEvent } from "@/lib/analytics/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client-originated events that cannot be inferred from a domain write. */
const CLIENT_EVENT_NAMES = [
  "look_viewed",
  "outbound_click",
] as const;

const bodySchema = z.object({
  name: z.string().min(1).max(64),
  props: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isProductEventName(parsed.data.name)) {
    return Response.json({ error: "Invalid event." }, { status: 400 });
  }

  if (
    !(CLIENT_EVENT_NAMES as readonly string[]).includes(parsed.data.name)
  ) {
    return Response.json({ error: "Event must be server-emitted." }, { status: 403 });
  }

  trackProductEvent({
    name: parsed.data.name,
    userId: auth.userId,
    props: parsed.data.props,
  });

  return Response.json({ ok: true });
}
