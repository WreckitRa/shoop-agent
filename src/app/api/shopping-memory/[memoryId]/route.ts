import { prisma } from "@/lib/ai-chat/db";
import { getAuthContext } from "@/lib/auth/session";

type RouteCtx = { params: Promise<{ memoryId: string }> };

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const { memoryId } = await ctx.params;
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const row = await prisma.shoppingMemory.findFirst({
      where: { id: memoryId, userId },
    });
    if (!row) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    await prisma.shoppingMemory.delete({ where: { id: memoryId } });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }
}
