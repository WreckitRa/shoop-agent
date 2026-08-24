import { revokeShareByToken } from "@/lib/ask/create-share";
import { prisma } from "@/lib/ai-chat/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** Immediately disable a share used to harass, then investigate. */
export async function POST(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token || token.length > 32) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const existing = await prisma.lookAskShare.findUnique({
    where: { token },
    select: { token: true },
  });
  if (!existing) return Response.json({ error: "Not found." }, { status: 404 });
  await revokeShareByToken({ token, reason: "reported" });
  return Response.json({ ok: true, disabled: true });
}
