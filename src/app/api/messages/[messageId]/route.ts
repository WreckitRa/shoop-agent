import { timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/ai-chat/db";
import { messagePatchSchema } from "@/lib/ai-chat/validators";
import { messageToDTO } from "@/lib/ai-chat/serialize";
import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ messageId: string }> };

function isAuthorizedDirectMessageMutation(req: Request): boolean {
  const expected = process.env.AI_CHAT_ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const provided = req.headers.get("x-ai-chat-admin-token")?.trim();
  if (!provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * PATCH a single message. Edit + clarification-submit + regenerate now flow
 * through `/api/chat` (single SSE round-trip with optimistic UI). This handler
 * is intentionally minimal: `status` / `content` restricted admin-only direct
 * mutation.
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const { messageId } = await ctx.params;
    const raw = await req.json();
    const parsed = messagePatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { id: true, userId: true } } },
    });

    if (
      !msg ||
      msg.conversation.userId !== userId
    ) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    const { status, content } = parsed.data;

    if (status === undefined && content === undefined) {
      return Response.json({ error: "Nothing to update." }, { status: 400 });
    }

    if (!isAuthorizedDirectMessageMutation(req)) {
      return Response.json(
        { error: "Direct message mutation is restricted." },
        { status: 403 },
      );
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(content !== undefined ? { content } : {}),
      },
    });

    return Response.json(messageToDTO(updated));
  } catch {
    return Response.json({ error: "Failed to update message." }, { status: 500 });
  }
}
