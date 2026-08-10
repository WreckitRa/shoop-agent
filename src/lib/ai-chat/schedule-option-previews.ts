/**
 * Option preview fetch + palette resolve + SSE hydrate + DB patch for fashion
 * clarification chips.
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
import {
  resolveClarificationPalettes,
  type ClarificationPaletteRequest,
} from "@/lib/ai-chat/clarification-palette-resolver";
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
  userId?: string;
  options: OptionPreviewRequest[];
  paletteOptions?: ClarificationPaletteRequest[];
  getBuyerContext: () => Promise<BuyerCatalogContext | null>;
  fallbackShippingCountry?: string | null;
  push: (chunk: string) => void;
  applyPreviews: (
    previewMap: Record<string, ClarificationOptionPreviewImage[]>,
  ) => Record<string, unknown>;
  applyPalettes?: (
    paletteMap: Record<string, string[]>,
  ) => Record<string, unknown>;
}): Promise<void> {
  const hasPreviews = params.options.length > 0;
  const hasPalettes = (params.paletteOptions?.length ?? 0) > 0;
  if (!hasPreviews && !hasPalettes) {
    return Promise.resolve();
  }

  return (async () => {
    try {
      const buyerPromise = hasPreviews
        ? params.getBuyerContext().catch(() => null)
        : Promise.resolve(null);

      const previewPromise = (async () => {
        if (!hasPreviews) return [] as Awaited<
          ReturnType<typeof fetchClarificationOptionPreviews>
        >;
        const buyer = await buyerPromise;
        const country =
          buyer?.shipsToCountry ?? params.fallbackShippingCountry ?? undefined;
        if (!country) {
          await persistOptionPreviewExpectationsCleared(params.messageId);
          return [];
        }
        return fetchClarificationOptionPreviews({
          options: params.options,
          shipsToCountry: country,
          context: buyer?.context as CatalogSearchContext | undefined,
          conversationId: params.conversationId,
        });
      })();

      const palettePromise = hasPalettes
        ? resolveClarificationPalettes({
            options: params.paletteOptions!,
            userId: params.userId,
            conversationId: params.conversationId,
          })
        : Promise.resolve([]);

      const [previewResults, paletteResults] = await Promise.all([
        previewPromise,
        palettePromise,
      ]);

      let metadataPatch: Record<string, unknown> = {};

      if (previewResults.length) {
        const previewMap: Record<string, ClarificationOptionPreviewImage[]> =
          {};
        for (const row of previewResults) {
          previewMap[row.optionId] = row.images;
        }
        metadataPatch = {
          ...metadataPatch,
          ...params.applyPreviews(previewMap),
        };
      }

      if (paletteResults.length && params.applyPalettes) {
        const paletteMap: Record<string, string[]> = {};
        for (const row of paletteResults) {
          paletteMap[row.optionId] = row.paletteColors;
        }
        metadataPatch = {
          ...metadataPatch,
          ...params.applyPalettes(paletteMap),
        };
      }

      if (!Object.keys(metadataPatch).length) return;

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
          palettes: paletteResults.map((r) => ({
            optionId: r.optionId,
            paletteColors: r.paletteColors,
          })),
        }),
      );
    } catch {
      /* best-effort */
    }
  })();
}
