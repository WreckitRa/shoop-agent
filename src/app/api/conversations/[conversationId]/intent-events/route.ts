import { listIntentEventsSince } from "@/lib/ai-chat/intent-branch/list";
import { prisma } from "@/lib/ai-chat/db";
import { getAuthContext } from "@/lib/auth/session";

type RouteCtx = { params: Promise<{ conversationId: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const { conversationId } = await ctx.params;

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true, deletedAt: true },
    });
    if (!conv || conv.deletedAt) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    const url = new URL(req.url);
    const sinceRaw = url.searchParams.get("since")?.trim();
    const since = sinceRaw ? new Date(sinceRaw) : new Date(0);
    if (Number.isNaN(since.getTime())) {
      return Response.json({ error: "Invalid since parameter." }, { status: 400 });
    }

    const branches = await listIntentEventsSince(conversationId, since);
    return Response.json({ branches });
  } catch {
    return Response.json({ error: "Failed to load intent events." }, { status: 500 });
  }
}
