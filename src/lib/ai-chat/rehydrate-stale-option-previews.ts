/**
 * Backfill preview images / palettes for messages that lost enrichment
 * (e.g. race before persist merge). Safe to call on conversation load.
 */
import {
  collectFashionPaletteRequests,
  collectFashionPreviewRequests,
  mergeOptionPalettesIntoFashionRouter,
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
    if (!meta?.fashionRouter) return false;
    const needsImages =
      messageExpectsOptionPreviews(meta) &&
      !messageHasOptionPreviewImages(meta);
    const needsPalettes =
      collectFashionPaletteRequests(meta.fashionRouter).length > 0;
    return needsImages || needsPalettes;
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
    // Still try palettes (no shipping country required).
  }

  const buyerPromise = loadBuyerCatalogContext(
    params.userId,
    "",
    params.conversationId,
  ).catch(() => null);

  await Promise.allSettled(
    stale.map(async (row) => {
      const meta = row.metadata as MessageMetadata;
      if (!meta.fashionRouter) return;

      const options = params.shippingCountry?.trim()
        ? collectFashionPreviewRequests(meta.fashionRouter)
        : [];
      const paletteOptions = collectFashionPaletteRequests(meta.fashionRouter);

      if (!options.length && !paletteOptions.length) return;

      let fashionRouterState = meta.fashionRouter;
      await runOptionPreviews({
        messageId: row.id,
        conversationId: params.conversationId,
        userId: params.userId,
        options,
        paletteOptions,
        getBuyerContext: () => buyerPromise,
        fallbackShippingCountry: params.shippingCountry,
        push: () => {},
        applyPreviews: (previewMap) => {
          const merged = mergeOptionPreviewsIntoFashionRouter(
            fashionRouterState,
            previewMap,
          );
          fashionRouterState = merged;
          return { fashionRouter: merged };
        },
        applyPalettes: (paletteMap) => {
          const merged = mergeOptionPalettesIntoFashionRouter(
            fashionRouterState,
            paletteMap,
          );
          fashionRouterState = merged;
          return { fashionRouter: merged };
        },
      });
    }),
  );
}
