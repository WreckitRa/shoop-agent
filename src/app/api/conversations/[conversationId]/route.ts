import { prisma } from "@/lib/ai-chat/db";
import {
  CONVERSATION_PAGE_MESSAGE_LIMIT,
} from "@/lib/ai-chat/constants";
import { conversationPatchSchema } from "@/lib/ai-chat/validators";
import { listBranchesForConversation } from "@/lib/ai-chat/intent-branch/list";
import { conversationToSummary, messageToDTO } from "@/lib/ai-chat/serialize";
import { rehydrateStaleOptionPreviewsForConversation } from "@/lib/ai-chat/rehydrate-stale-option-previews";
import { getAuthContext } from "@/lib/auth/session";

type RouteCtx = { params: Promise<{ conversationId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const { conversationId } = await ctx.params;

    // Fetch conversation + messages in parallel; cap messages at a reasonable
    // page so long chats don't pay an unbounded cost on every reload.
    const [conv, recentDescending] = await Promise.all([
      prisma.conversation.findFirst({
        where: { id: conversationId, userId: userId },
      }),
      prisma.message.findMany({
        where: {
          conversationId,
          conversation: { userId: userId },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: CONVERSATION_PAGE_MESSAGE_LIMIT,
      }),
    ]);

    if (!conv || conv.deletedAt) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    const messages = recentDescending.reverse().map(messageToDTO);
    const branches = await listBranchesForConversation(conversationId);
    const activeBranchId =
      branches.length > 0 ? branches[branches.length - 1]!.id : null;

    void rehydrateStaleOptionPreviewsForConversation({
      conversationId,
      userId,
      shippingCountry: conv.shippingCountry,
    }).catch(() => {});

    return Response.json({
      conversation: conversationToSummary(conv),
      messages,
      branches,
      activeBranchId,
    });
  } catch {
    return Response.json({ error: "Failed to load conversation." }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const { conversationId } = await ctx.params;
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: userId },
    });
    if (!conv || conv.deletedAt) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    const raw = await req.json();
    const parsed = conversationPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid request.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.archived !== undefined ? { archived: body.archived } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.model !== undefined ? { model: body.model } : {}),
        ...(body.temperature !== undefined
          ? { temperature: body.temperature }
          : {}),
        ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens } : {}),
        ...(body.responseStyle !== undefined
          ? { responseStyle: body.responseStyle }
          : {}),
        ...(body.systemPrompt !== undefined
          ? { systemPrompt: body.systemPrompt }
          : {}),
        ...(body.shippingCountry !== undefined
          ? { shippingCountry: body.shippingCountry }
          : {}),
        ...(body.currency !== undefined
          ? {
              currency:
                body.currency === null
                  ? null
                  : body.currency.toUpperCase().slice(0, 6),
            }
          : {}),
      },
    });

    return Response.json(conversationToSummary(updated));
  } catch {
    return Response.json({ error: "Failed to update conversation." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const { conversationId } = await ctx.params;
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: userId },
    });
    if (!conv || conv.deletedAt) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Failed to delete conversation." }, { status: 500 });
  }
}
