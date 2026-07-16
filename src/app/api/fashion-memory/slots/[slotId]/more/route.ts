import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { handleShowMore } from "@/lib/fashion-memory/curation/interaction-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  messageId: z.string().min(1),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slotId: string }> },
) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const { slotId } = await ctx.params;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }
    return handleShowMore(
      { messageId: parsed.data.messageId, slotId },
      auth.userId,
    );
  } catch {
    return Response.json({ error: "Show more failed." }, { status: 500 });
  }
}
