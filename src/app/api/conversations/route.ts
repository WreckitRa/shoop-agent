import { userVisibleConversationWhere } from "@/lib/ai-chat/conversation-visibility";
import { prisma } from "@/lib/ai-chat/db";
import {
  NEW_CHAT_TITLE,
  AI_CHAT_DEFAULT_MODEL,
  isAllowedModel,
} from "@/lib/ai-chat/constants";
import {
  conversationPostSchema,
} from "@/lib/ai-chat/validators";
import { bootstrapConversationBranch } from "@/lib/ai-chat/intent-branch/bootstrap";
import { listBranchesByConversationIds } from "@/lib/ai-chat/intent-branch/list";
import { conversationToSummary } from "@/lib/ai-chat/serialize";
import type { SidebarConversationNode } from "@/lib/ai-chat/types";
import { localeSnapshotFromProfile } from "@/lib/shopify/catalog-localization";
import { loadDefaultSavedAddressLocale } from "@/lib/shopify/default-saved-address";
import { getAuthContext } from "@/lib/auth/session";

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("includeArchived") === "1";

    const rows = await prisma.conversation.findMany({
      where: userVisibleConversationWhere(userId, { includeArchived }),
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });

    const branchMap = await listBranchesByConversationIds(rows.map((r) => r.id));
    const nodes: SidebarConversationNode[] = rows.map((row) => {
      const branches = branchMap.get(row.id) ?? [];
      const visibleBranches =
        branches.length > 1
          ? branches.filter((b) => b.anchorMessageId && b.index > 0)
          : [];
      return {
        conversation: conversationToSummary(row),
        branches: visibleBranches,
      };
    });

    return Response.json(nodes);
  } catch {
    return Response.json({ error: "Failed to load conversations." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const raw = await req.json();
    const parsed = conversationPostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }

    const body = parsed.data;
    const model =
      body.model && isAllowedModel(body.model)
        ? body.model
        : AI_CHAT_DEFAULT_MODEL;

    const [profileRow, savedAddress] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
        select: { shippingCountry: true, country: true, currency: true },
      }),
      loadDefaultSavedAddressLocale(userId),
    ]);

    const locale = localeSnapshotFromProfile(profileRow, savedAddress);

    const conv = await prisma.conversation.create({
      data: {
        title: body.title?.trim() || NEW_CHAT_TITLE,
        userId,
        archived: body.archived ?? false,
        pinned: body.pinned ?? false,
        model,
        temperature: body.temperature ?? 0.7,
        maxTokens: body.maxTokens ?? 4096,
        responseStyle: body.responseStyle ?? "balanced",
        systemPrompt:
          body.systemPrompt === undefined ? null : body.systemPrompt,
        shippingCountry: locale.shippingCountry,
        currency: locale.currency,
      },
    });

    await bootstrapConversationBranch({
      conversationId: conv.id,
      title: conv.title,
    });

    return Response.json({
      conversation: conversationToSummary(conv),
      branches: [],
    } satisfies SidebarConversationNode);
  } catch {
    return Response.json({ error: "Failed to create conversation." }, { status: 500 });
  }
}
