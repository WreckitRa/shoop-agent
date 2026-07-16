import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { startOutfitTryon } from "@/lib/tryon/run-outfit";
import { TryonCapError } from "@/lib/tryon/generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  search_id: z.string().min(1),
  look_id: z.string().min(1),
});

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const result = await startOutfitTryon({
      userId: auth.userId,
      searchId: parsed.data.search_id,
      lookId: parsed.data.look_id,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TryonCapError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    const message = error instanceof Error ? error.message : "Outfit try-on failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
