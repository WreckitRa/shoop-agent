import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { startAvatarFlow } from "@/lib/tryon/avatar/service";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  person_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const owner = await requireAvatarOwner(req, auth);
  if (!owner.ok) return owner.response;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const draft = await startAvatarFlow({
      userId: owner.userId,
      personId: parsed.data.person_id,
    });
    return Response.json({ ok: true, draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Start failed.";
    console.error("[shoop] avatar start failed", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
