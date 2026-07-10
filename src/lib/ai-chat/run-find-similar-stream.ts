/**
 * Direct SSE handler for "Find similar" — bypasses the Anthropic chat loop.
 *
 * Per seed: load full Shopify product → LLM plans 4 like-anchored catalog queries
 * → run in parallel → merge when multi-select.
 */
import { prisma } from "./db";
import {
  ensureConversationForUser,
  kickConversationTitleRename,
  persistAssistantFinal,
  skipPendingClarificationsForConversation,
  touchConversationUpdatedAt,
} from "./chat-service";
import {
  anchorBootstrapBranchIfNeeded,
  getOrCreateActiveBranchId,
} from "./intent-branch/bootstrap";
import { logAiChat } from "./observability";
import type { chatPostBodySchema } from "./validators";
import type {
  MessageMetadata,
  MessageProductSearchV1,
  ProductSearchInvocation,
  ShoppingModeMetaV1,
} from "./types";
import { formatFindSimilarUserText } from "./search/find-similar/action";
import { loadFindSimilarContext } from "./search/find-similar/load-context";
import {
  mergeSimilarSearchResults,
  type SimilarEngineResult,
} from "./search/find-similar/merge-results";
import { buildSimilarIntroText } from "./search/find-similar/narration";
import { runSimilarSearchEngine } from "./search/find-similar/run-similar-engine";
import {
  normalizeFindSimilarSeeds,
  type FindSimilarPayload,
  type FindSimilarSeed,
} from "./search/find-similar/types";
import {
  loadFeedbackAvoidSet,
  recordFeedbackEvent,
} from "./search/learning";
import { buildFindSimilarExcludedKeys } from "./search/find-similar/relax-brief";
import {
  logFindSimilar,
  logFindSimilarBanner,
} from "./search/find-similar/debug-log";
import { productDisplayLimitForMode } from "./shopping-mode";
import { persistCuratedPicks } from "./curation/curator";
import { loadBuyerCatalogContext } from "./shopping-memory/search-hints";
import { resolveCatalogLocalization } from "@/lib/shopify/catalog-localization";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { createTextDeltaCoalescer, formatSse, SSE_HEARTBEAT } from "./sse";
import type { z } from "zod";

type ChatBody = z.infer<typeof chatPostBodySchema>;

function seedPayloadFor(
  payload: FindSimilarPayload,
  seed: FindSimilarSeed,
): FindSimilarPayload {
  return {
    sourceMessageId: payload.sourceMessageId,
    confirmedAttribute: payload.confirmedAttribute,
    productId: seed.productId,
    productTitle: seed.productTitle,
    upid: seed.upid,
    seeds: [seed],
  };
}

function batchExcludedKeys(
  seeds: FindSimilarSeed[],
  currentSeedId: string,
  base: Set<string>,
): Set<string> {
  const out = new Set(base);
  for (const seed of seeds) {
    if (seed.productId !== currentSeedId) out.add(seed.productId);
    if (seed.upid?.trim()) out.add(seed.upid.trim());
  }
  return out;
}

export function createFindSimilarSseStream(params: {
  body: ChatBody;
  signal?: AbortSignal;
  userId: string;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const userId = params.userId;
  const payload = params.body.findSimilar as FindSimilarPayload;

  return new ReadableStream({
    async start(controller) {
      let closed = false;
      const push = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => push(SSE_HEARTBEAT), 15_000);
      const coalescer = createTextDeltaCoalescer(push);
      const streamStartedAt = Date.now();

      try {
        logFindSimilarBanner("FIND SIMILAR START");
        logFindSimilar("trigger", {
          userId,
          conversationId: params.body.conversationId ?? null,
          sourceMessageId: payload.sourceMessageId,
          confirmedAttribute: payload.confirmedAttribute ?? null,
          seeds: normalizeFindSimilarSeeds(payload),
        });

        const ensured = await ensureConversationForUser({
          conversationId: params.body.conversationId,
          userId,
        });
        const conv = ensured;
        push(
          formatSse("conversation", {
            conversationId: conv.id,
            shippingCountry: conv.shippingCountry,
            currency: conv.currency,
          }),
        );

        await skipPendingClarificationsForConversation(conv.id);
        const activeBranchId = await getOrCreateActiveBranchId(conv.id, conv.title);

        const seeds = normalizeFindSimilarSeeds(payload);
        if (!seeds.length) {
          logFindSimilar("abort", { reason: "no_seeds" });
          push(formatSse("error", { message: "No products selected for find similar." }));
          push(formatSse("done", { status: "failed", conversationId: conv.id }));
          return;
        }

        const userText = formatFindSimilarUserText(seeds);
        const userRow = await prisma.message.create({
          data: {
            conversationId: conv.id,
            role: "user",
            content: userText,
            status: "completed",
            branchId: activeBranchId,
          },
        });
        void anchorBootstrapBranchIfNeeded(conv.id, userRow.id);
        push(formatSse("user_message", { messageId: userRow.id }));

        const catalogToken = await accessTokenForCatalogMcp().catch((): null => null);
        if (catalogToken === null) {
          logFindSimilar("abort", { reason: "catalog_auth_failed" });
          push(formatSse("error", { message: "Catalog authentication failed." }));
          push(formatSse("done", { status: "failed", conversationId: conv.id }));
          return;
        }

        const primarySeed = seeds[0]!;

        const loadedContexts = await Promise.all(
          seeds.map((seed) =>
            loadFindSimilarContext({
              conversationId: conv.id,
              payload: seedPayloadFor(payload, seed),
              accessToken: catalogToken,
              currency: conv.currency ?? "USD",
              hypothesis: null,
            }),
          ),
        );

        if (loadedContexts.some((ctx) => !ctx)) {
          logFindSimilar("abort", {
            reason: "pick_not_in_source_message",
            sourceMessageId: payload.sourceMessageId,
            requestedSeeds: seeds,
          });
          push(
            formatSse("error", {
              message: "Could not find one or more picks in this conversation.",
            }),
          );
          push(formatSse("done", { status: "failed", conversationId: conv.id }));
          return;
        }

        const loadedList = loadedContexts as NonNullable<
          (typeof loadedContexts)[number]
        >[];
        const loaded = loadedList[0]!;

        logFindSimilar("context_loaded", {
          seedCount: loadedList.length,
          seeds: loadedList.map((ctx, i) => ({
            index: i,
            productId: ctx.pick.id,
            title: ctx.pick.title,
            upid: ctx.similar.seedUpid ?? null,
            seedPriceCents: ctx.similar.seedPriceCents,
            hasCatalogDetail: Boolean(ctx.seedCatalogDetail),
            parentInvocationQuery: ctx.brief.query,
            relaxedBudget: ctx.brief.budget,
            archetype: ctx.brief.archetype,
            directionLabel: ctx.brief.directionLabel ?? null,
            siblingCount: ctx.similar.siblingPicks.length,
          })),
        });

        const assistantRow = await prisma.message.create({
          data: {
            conversationId: conv.id,
            role: "assistant",
            content: "",
            status: "streaming",
            model: conv.model,
            branchId: activeBranchId,
          },
        });
        push(formatSse("assistant_message", { messageId: assistantRow.id }));

        const shoppingMode: ShoppingModeMetaV1 = {
          version: 1,
          mode: "judge",
          source: "user",
          reason: "find_similar",
        };
        push(formatSse("mode_resolved", shoppingMode));

        const [feedback, buyerContext] = await Promise.all([
          loadFeedbackAvoidSet(userId, loaded.brief).catch(() => undefined),
          loadBuyerCatalogContext(userId, loaded.brief.query, conv.id).catch(
            () => null,
          ),
        ]);

        // Match regular search: catalog filters need ISO-3166 codes (e.g. LB),
        // not conversation labels (e.g. "Lebanon") — raw labels fail search_catalog.
        const shipsToCountry =
          buyerContext?.shipsToCountry ??
          resolveCatalogLocalization(conv.shippingCountry ?? null, null)
            .shipsTo ??
          undefined;

        logFindSimilar("locale_mapped", {
          convShippingCountryRaw: conv.shippingCountry ?? null,
          convCurrency: conv.currency ?? null,
          buyerContextShipsTo: buyerContext?.shipsToCountry ?? null,
          resolvedShipsToCountry: shipsToCountry ?? null,
          catalogContext: buyerContext?.context ?? null,
        });

        const searchKey = `similar_${seeds.map((s) => s.productId).join("_")}_${Date.now()}`;
        const displayLimit = productDisplayLimitForMode("judge");
        const seedExcludedKeys = buildFindSimilarExcludedKeys(seeds);
        const displayQuery = formatFindSimilarUserText(seeds);

        logFindSimilar("engine_dispatch", {
          searchKey,
          displayLimit,
          displayQuery,
          seedExcludedKeys: [...seedExcludedKeys],
          perSeedExcluded: loadedList.map((_, index) => [
            ...batchExcludedKeys(seeds, seeds[index]!.productId, seedExcludedKeys),
          ]),
        });

        const engineRuns = await Promise.all(
          loadedList.map((ctx, index) =>
            runSimilarSearchEngine({
              brief: ctx.brief,
              similar: ctx.similar,
              pick: ctx.pick,
              userId,
              accessToken: catalogToken,
              displayLimit,
              shipsToCountry,
              context: buyerContext?.context,
              excludedKeys: batchExcludedKeys(
                seeds,
                seeds[index]!.productId,
                seedExcludedKeys,
              ),
              feedback,
              signal: params.signal,
              seedCatalogProduct: ctx.seedCatalog,
              seedCatalogDetail: ctx.seedCatalogDetail,
              confirmedAttribute: payload.confirmedAttribute,
              deadlineMs: 12000,
              onNarration: (line) => {
                push(
                  formatSse("narration_line", {
                    searchKey,
                    line,
                  }),
                );
              },
            }),
          ),
        );

        const engine: SimilarEngineResult =
          engineRuns.length === 1
            ? engineRuns[0]!
            : mergeSimilarSearchResults(
                engineRuns,
                new Set(seeds.map((s) => s.productId)),
                new Set(
                  seeds.map((s) => s.upid?.trim()).filter(Boolean) as string[],
                ),
                displayLimit,
              );

        logFindSimilar("engine_merged", {
          seedCount: engineRuns.length,
          perSeed: engineRuns.map((r, i) => ({
            seedProductId: seeds[i]?.productId,
            rawCount: r.rawCount,
            picks: r.curatedPicks.length,
            products: r.products.length,
            thin: r.thin,
            queryStats: r.stats,
          })),
          merged: {
            picks: engine.curatedPicks.length,
            products: engine.products.length,
            rawCount: engine.rawCount,
          },
        });

        for (let i = 0; i < seeds.length; i++) {
          const seed = seeds[i]!;
          const ctx = loadedList[i]!;
          void recordFeedbackEvent({
            userId,
            conversationId: conv.id,
            messageId: userRow.id,
            productExternalId: seed.productId,
            upid: seed.upid ?? ctx.similar.seedUpid ?? null,
            reason: "find_similar_tap",
            scope: ctx.brief.recipient.kind === "self" ? "self" : "gift",
            archetype: ctx.brief.archetype,
          });
        }

        const seedTitles = seeds.map((s) => s.productTitle);
        const plans = engineRuns.map((r) => r.plan);
        const intro = buildSimilarIntroText(
          seedTitles.length === 1 ? seedTitles[0]! : seedTitles,
          engine.curatedPicks.length,
          plans,
        );
        coalescer.enqueue(intro);
        coalescer.flush();

        const invocation: ProductSearchInvocation = {
          query: displayQuery,
          filters: {
            price_min_cents: loaded.brief.budget.minCents ?? undefined,
            price_max_cents: loaded.brief.budget.maxCents ?? loaded.brief.budget.amountCents ?? undefined,
            condition: loaded.brief.condition,
            ships_to_country: shipsToCountry,
          },
          intent: "find_similar",
          products: engine.products,
          curatedPicks: engine.curatedPicks,
          displayLimit,
          truncated: engine.rawCount > engine.products.length,
          curationFallback: engine.curationFallback,
          searchKey,
          archetype: loaded.brief.archetype,
          directionLabel: loaded.brief.directionLabel,
        };

        push(formatSse("product_search", invocation));

        const productSearchMeta: MessageProductSearchV1 = {
          version: 1,
          searches: [invocation],
        };

        const metadata: MessageMetadata = {
          productSearch: productSearchMeta,
          shoppingMode,
          similarTasteProbe: {
            version: 1,
            seedProductId: primarySeed.productId,
            seedTitle: primarySeed.productTitle,
            sourceMessageId: payload.sourceMessageId,
            upid: primarySeed.upid ?? loaded.similar.seedUpid,
            seeds: seeds.length > 1 ? seeds : undefined,
          },
        };

        await persistCuratedPicks(
          {
            userId,
            conversationId: conv.id,
            messageId: assistantRow.id,
            searchInput: {
              query: displayQuery,
              intent: "find_similar",
              filters: {
                price_min_cents: loaded.brief.budget.minCents ?? undefined,
                price_max_cents:
                  loaded.brief.budget.maxCents ??
                  loaded.brief.budget.amountCents ??
                  undefined,
                condition: loaded.brief.condition as
                  | ("new" | "secondhand" | "refurbished")[]
                  | undefined,
                ships_to_country: shipsToCountry,
              },
            },
          },
          engine.curatedPicks,
        ).catch(() => undefined);

        await persistAssistantFinal({
          messageId: assistantRow.id,
          content: intro,
          status: "completed",
          model: conv.model,
          finishReason: "find_similar",
          metadata,
        });
        await touchConversationUpdatedAt(conv.id);

        const isFirstTurn = !params.body.conversationId;
        if (isFirstTurn) kickConversationTitleRename(conv.id);

        logAiChat("info", "find_similar_stream_completed", {
          conversationId: conv.id,
          seedProductIds: seeds.map((s) => s.productId),
          seedCount: seeds.length,
          catalogQueries: engineRuns.reduce(
            (n, r) => n + r.plan.searches.length,
            0,
          ),
          picks: engine.curatedPicks.length,
          durationMs: Date.now() - streamStartedAt,
        });

        logFindSimilar("done", {
          conversationId: conv.id,
          assistantMessageId: assistantRow.id,
          intro,
          pickCount: engine.curatedPicks.length,
          productCount: engine.products.length,
          durationMs: Date.now() - streamStartedAt,
        });

        push(
          formatSse("done", {
            messageId: assistantRow.id,
            conversationId: conv.id,
            status: "completed",
            finishReason: "find_similar",
            isFirstTurn,
            content: intro,
            metadata,
          }),
        );
      } catch (error) {
        logFindSimilar("failed", { error: String(error) });
        logAiChat("error", "find_similar_stream_failed", { error: String(error) });
        push(formatSse("error", { message: "Find similar search failed." }));
        push(formatSse("done", { status: "failed" }));
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}
