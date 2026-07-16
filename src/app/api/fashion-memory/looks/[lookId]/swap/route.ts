import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { handleLookSwap } from "@/lib/fashion-memory/curation/interaction-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  messageId: z.string().min(1),
  slot_id: z.string().min(1),
  chosen_ref: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ lookId: string }> },
) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const { lookId } = await ctx.params;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }
    return handleLookSwap(
      { ...parsed.data, lookId },
      auth.userId,
    );
  } catch {
    return Response.json({ error: "Look swap failed." }, { status: 500 });
  }
}
