import { prisma } from "@/lib/ai-chat/db";
import { brandPreferencePatchSchema } from "@/lib/ai-chat/profile/validators";
import { getAuthContext } from "@/lib/auth/session";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const raw = await req.json();
    const parsed = brandPreferencePatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const existing = await prisma.brandPreference.findFirst({ where: { id, userId } });
    if (!existing) return Response.json({ error: "Not found." }, { status: 404 });

    const b = parsed.data;
    const row = await prisma.brandPreference.update({
      where: { id },
      data: {
        sentiment: b.sentiment ?? undefined,
        strength: b.strength ?? undefined,
        reasons: b.reasons ?? undefined,
        ownsProducts: b.ownsProducts ?? undefined,
        aspirational: b.aspirational ?? undefined,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });
    return Response.json({ brandPreference: row });
  } catch {
    return Response.json({ error: "Update failed." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const existing = await prisma.brandPreference.findFirst({ where: { id, userId } });
    if (!existing) return Response.json({ error: "Not found." }, { status: 404 });
    await prisma.brandPreference.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }
}
