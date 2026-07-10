/**
 * Option preview fetch + SSE hydrate + DB patch.
 * Shared by clarification chips and gift-direction chips.
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
import { logOptionPreview } from "@/lib/ai-chat/option-preview-log";
import { formatSse } from "@/lib/ai-chat/sse";
import type { ClarificationOptionPreviewImage } from "@/lib/ai-chat/types";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { BuyerCatalogContext } from "@/lib/ai-chat/shopping-memory/search-hints";
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

  logOptionPreview("expectations_cleared", { messageId });
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
    logOptionPreview("skip_no_options", {
      messageId: params.messageId,
      conversationId: params.conversationId,
    });
    return Promise.resolve();
  }

  logOptionPreview("start", {
    messageId: params.messageId,
    conversationId: params.conversationId,
    optionCount: params.options.length,
    optionIds: params.options.map((o) => o.id),
  });

  return (async () => {
    const startedAt = Date.now();
    try {
      const buyer = await params.getBuyerContext().catch(() => null);
      const country =
        buyer?.shipsToCountry ?? params.fallbackShippingCountry ?? undefined;

      if (!country) {
        logOptionPreview("skip_no_shipping_country", {
          messageId: params.messageId,
          conversationId: params.conversationId,
        });
        await persistOptionPreviewExpectationsCleared(params.messageId);
        return;
      }

      logOptionPreview("fetching", {
        messageId: params.messageId,
        country,
        optionCount: params.options.length,
      });

      const previewResults = await fetchClarificationOptionPreviews({
        options: params.options,
        shipsToCountry: country,
        context: buyer?.context as CatalogSearchContext | undefined,
        conversationId: params.conversationId,
      });

      logOptionPreview("fetch_done", {
        messageId: params.messageId,
        durationMs: Date.now() - startedAt,
        resultCount: previewResults.length,
        withImages: previewResults.map((r) => ({
          optionId: r.optionId,
          imageCount: r.images.length,
        })),
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

      logOptionPreview("persisted", {
        messageId: params.messageId,
        patchKeys: Object.keys(metadataPatch),
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

      logOptionPreview("sse_pushed", {
        messageId: params.messageId,
        previewCount: previewResults.length,
      });
    } catch (err) {
      logOptionPreview("error", {
        messageId: params.messageId,
        conversationId: params.conversationId,
        durationMs: Date.now() - startedAt,
        error: String(err).slice(0, 300),
      });
    }
  })();
}

/** @deprecated Prefer runOptionPreviews — kept for call-site clarity. */
export function scheduleOptionPreviews(
  params: Parameters<typeof runOptionPreviews>[0] & {
    signal?: AbortSignal;
    isClosed?: () => boolean;
  },
): Promise<void> {
  return runOptionPreviews(params);
}
