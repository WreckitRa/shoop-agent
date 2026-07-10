import { prisma } from "@/lib/ai-chat/db";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const { id } = await ctx.params;
    const existing = await prisma.savedAddress.findFirst({
      where: { id, userId: userId },
    });
    if (!existing) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    await prisma.savedAddress.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json(
      { error: "Could not delete address." },
      { status: 500 },
    );
  }
}
