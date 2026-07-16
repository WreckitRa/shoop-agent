import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { handleRecurate } from "@/lib/fashion-memory/curation/interaction-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  messageId: z.string().min(1),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    await ctx.params;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }
    return handleRecurate({ messageId: parsed.data.messageId }, auth.userId);
  } catch {
    return Response.json({ error: "Re-curate failed." }, { status: 500 });
  }
}
