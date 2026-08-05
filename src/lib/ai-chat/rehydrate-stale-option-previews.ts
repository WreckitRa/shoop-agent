/**
 * Backfill preview images for messages that have previewQuery but lost images
 * (e.g. race before persist merge). Safe to call on conversation load.
 */
import {
  collectFashionPreviewRequests,
  mergeOptionPreviewsIntoFashionRouter,
} from "@/lib/fashion-memory/router/clarification-defaults";
import { prisma } from "@/lib/ai-chat/db";
import { runOptionPreviews } from "@/lib/ai-chat/schedule-option-previews";
import { loadBuyerCatalogContext } from "@/lib/ai-chat/buyer-catalog/search-hints";
import {
  clearOptionPreviewExpectations,
  messageExpectsOptionPreviews,
  messageHasOptionPreviewImages,
} from "@/lib/ai-chat/merge-option-preview-metadata";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";

export async function rehydrateStaleOptionPreviewsForConversation(params: {
  conversationId: string;
  userId: string;
  shippingCountry?: string | null;
}): Promise<void> {
  const rows = await prisma.message.findMany({
    where: {
      conversationId: params.conversationId,
      conversation: { userId: params.userId },
      role: "assistant",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 12,
    select: { id: true, metadata: true },
  });

  const stale = rows.filter((row) => {
    const meta = row.metadata as MessageMetadata | null;
    return (
      meta &&
      messageExpectsOptionPreviews(meta) &&
      !messageHasOptionPreviewImages(meta)
    );
  });

  if (!stale.length) return;

  if (!params.shippingCountry?.trim()) {
    await Promise.allSettled(
      stale.map(async (row) => {
        const meta = row.metadata as MessageMetadata;
        const cleared = clearOptionPreviewExpectations(meta);
        if (!cleared) return;
        await prisma.message.update({
          where: { id: row.id },
          data: { metadata: cleared as InputJsonValue },
        });
      }),
    );
    return;
  }


  const buyerPromise = loadBuyerCatalogContext(
    params.userId,
    "",
    params.conversationId,
  ).catch(() => null);

  await Promise.allSettled(
    stale.map(async (row) => {
      const meta = row.metadata as MessageMetadata;
      const options = meta.fashionRouter
        ? collectFashionPreviewRequests(meta.fashionRouter)
        : [];

      if (!options.length) return;

      await runOptionPreviews({
        messageId: row.id,
        conversationId: params.conversationId,
        options,
        getBuyerContext: () => buyerPromise,
        fallbackShippingCountry: params.shippingCountry,
        push: () => {},
        applyPreviews: (previewMap) => {
          if (meta.fashionRouter) {
            const merged = mergeOptionPreviewsIntoFashionRouter(
              meta.fashionRouter,
              previewMap,
            );
            return { fashionRouter: merged };
          }
          return {};
        },
      });
    }),
  );

}
