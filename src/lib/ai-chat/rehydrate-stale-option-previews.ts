/**
 * Backfill preview images for messages that have previewQuery but lost images
 * (e.g. race before persist merge). Safe to call on conversation load.
 */
import { prisma } from "@/lib/ai-chat/db";
import { logOptionPreview } from "@/lib/ai-chat/option-preview-log";
import { runOptionPreviews } from "@/lib/ai-chat/schedule-option-previews";
import {
  collectPreviewRequests,
  mergeOptionPreviewsIntoClarification,
} from "@/lib/ai-chat/search-clarification";
import {
  collectGiftDirectionPreviewRequests,
  mergeOptionPreviewsIntoGiftDirections,
} from "@/lib/ai-chat/search/gift-directions";
import { loadBuyerCatalogContext } from "@/lib/ai-chat/shopping-memory/search-hints";
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
    logOptionPreview("rehydrate_skip_no_shipping_country", {
      conversationId: params.conversationId,
      messageCount: stale.length,
    });
    return;
  }

  logOptionPreview("rehydrate_start", {
    conversationId: params.conversationId,
    messageCount: stale.length,
  });

  const buyerPromise = loadBuyerCatalogContext(
    params.userId,
    "",
    params.conversationId,
  ).catch(() => null);

  await Promise.allSettled(
    stale.map(async (row) => {
      const meta = row.metadata as MessageMetadata;
      const options = meta.clarification
        ? collectPreviewRequests(meta.clarification)
        : meta.giftDirections
          ? collectGiftDirectionPreviewRequests(meta.giftDirections)
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
          if (meta.clarification) {
            const merged = mergeOptionPreviewsIntoClarification(
              meta.clarification,
              previewMap,
            );
            return { clarification: merged };
          }
          if (meta.giftDirections) {
            const merged = mergeOptionPreviewsIntoGiftDirections(
              meta.giftDirections,
              previewMap,
            );
            return { giftDirections: merged };
          }
          return {};
        },
      });
    }),
  );

  logOptionPreview("rehydrate_done", {
    conversationId: params.conversationId,
    messageCount: stale.length,
  });
}
