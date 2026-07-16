import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { saveTryonFeedback } from "@/lib/tryon/generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  generation_id: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(-1)]),
});

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  await saveTryonFeedback({
    generationId: parsed.data.generation_id,
    userId: auth.userId,
    rating: parsed.data.rating,
  });
  return Response.json({ ok: true });
}
