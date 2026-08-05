/**
 * Option preview fetch + SSE hydrate + DB patch for fashion clarification chips.
 *
 * Returns a promise so the chat stream can await hydration (bounded) before
 * emitting `done` — otherwise the SSE connection closes while fetches are
 * still in flight and previews never reach the client.
 */
import { prisma } from "@/lib/ai-chat/db";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import {
  fetchClarificationOptionPreviews,
  type OptionPreviewRequest,
} from "@/lib/ai-chat/clarification-option-previews";
import { clearOptionPreviewExpectations } from "@/lib/ai-chat/merge-option-preview-metadata";
import { formatSse } from "@/lib/ai-chat/sse";
import type { ClarificationOptionPreviewImage } from "@/lib/ai-chat/types";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { BuyerCatalogContext } from "@/lib/ai-chat/buyer-catalog/search-hints";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";

async function persistOptionPreviewExpectationsCleared(
  messageId: string,
): Promise<void> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: { metadata: true },
  });
  const meta = row?.metadata as MessageMetadata | null;
  if (!meta) return;

  const cleared = clearOptionPreviewExpectations(meta);
  if (!cleared) return;

  await prisma.message.update({
    where: { id: messageId },
    data: { metadata: cleared as InputJsonValue },
  });

}

export function runOptionPreviews(params: {
  messageId: string;
  conversationId: string;
  options: OptionPreviewRequest[];
  getBuyerContext: () => Promise<BuyerCatalogContext | null>;
  fallbackShippingCountry?: string | null;
  push: (chunk: string) => void;
  applyPreviews: (
    previewMap: Record<string, ClarificationOptionPreviewImage[]>,
  ) => Record<string, unknown>;
}): Promise<void> {
  if (!params.options.length) {
    return Promise.resolve();
  }


  return (async () => {
    const startedAt = Date.now();
    try {
      const buyer = await params.getBuyerContext().catch(() => null);
      const country =
        buyer?.shipsToCountry ?? params.fallbackShippingCountry ?? undefined;

      if (!country) {
        await persistOptionPreviewExpectationsCleared(params.messageId);
        return;
      }


      const previewResults = await fetchClarificationOptionPreviews({
        options: params.options,
        shipsToCountry: country,
        context: buyer?.context as CatalogSearchContext | undefined,
        conversationId: params.conversationId,
      });


      if (!previewResults.length) return;

      const previewMap: Record<string, ClarificationOptionPreviewImage[]> = {};
      for (const row of previewResults) {
        previewMap[row.optionId] = row.images;
      }

      const metadataPatch = params.applyPreviews(previewMap);

      const existingMeta =
        (await prisma.message.findUnique({
          where: { id: params.messageId },
          select: { metadata: true },
        }))?.metadata ?? {};

      await prisma.message.update({
        where: { id: params.messageId },
        data: {
          metadata: {
            ...(existingMeta as Record<string, unknown>),
            ...metadataPatch,
          } as InputJsonValue,
        },
      });


      params.push(
        formatSse("option_previews", {
          messageId: params.messageId,
          previews: previewResults.map((r) => ({
            optionId: r.optionId,
            images: r.images,
          })),
        }),
      );

    } catch (err) {
    }
  })();
}
