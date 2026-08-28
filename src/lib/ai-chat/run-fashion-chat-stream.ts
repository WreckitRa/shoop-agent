/**
 * Fashion chat router — one LLM call, three forced tools per turn.
 */
import { prisma } from "./db";
import {
  deleteMessagesStrictlyAfter,
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
import { isSupabaseAuthUserId } from "@/lib/fashion-memory/auth";
import { isGuestUserId } from "@/lib/auth/guest-session";
import {
  emptyGuestFashionMemorySnapshot,
  type GuestFashionMemorySnapshot,
} from "@/lib/fashion-memory/local/store";
import {
  assembleRouterContext,
  writeRequestEventFromBrief,
} from "@/lib/fashion-memory/router/assemble-router-context";
import { requestAttributesFromBrief } from "@/lib/fashion-memory/router/request-event-from-brief";
import { spawnDetachedFashionExtraction } from "@/lib/fashion-memory/extraction/spawn";
import { scheduleDetachedWork } from "@/lib/fashion-memory/schedule-detached";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";
import {
  fashionSearchPlanToMetadata,
  planSearchFromBrief,
} from "@/lib/fashion-memory/search-planner/plan-from-brief";
import { resolveFashionRouterTurn } from "@/lib/fashion-memory/intake/post-router";
import { clarificationAnswersAreTaps } from "@/lib/fashion-memory/router/pull-sheet";
import { isGapDeclined } from "@/lib/fashion-memory/intake/dodge-counter";
import {
  collectFashionPaletteRequests,
  collectFashionPreviewRequests,
  ensureQuestionsHaveQuickOptions,
  fashionRouterExpectsOptionPreviews,
  mergeOptionPalettesIntoFashionRouter,
  mergeOptionPreviewsIntoFashionRouter,
} from "@/lib/fashion-memory/router/clarification-defaults";
import {
  fashionCatalogSearchToMetadata,
  loadFashionSearchProfile,
  searchFashionCatalogPlan,
} from "@/lib/fashion-memory/catalog-search";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { safeTrim } from "@/lib/fashion-memory/safe-trim";
import { buildRenderContract } from "@/lib/fashion-memory/curation/build-render-contract";
import { buildRenderContractWithTryon } from "@/lib/tryon/attach-render";
import { logAiChat } from "./observability";
import {
  checkBriefInvariants,
  closeFashionTrace,
  isConsecutiveDuplicateUserTurn,
  markFashionTraceError,
  openFashionTrace,
  beginTurnPipelineBuffer,
  drainTurnPipelineBuffer,
  recordPipelineEvent,
  drainTurnLlmCostBuffer,
} from "@/lib/fashion-memory/observability";
import {
  clearQaFaultsForConversation,
  enterQaConversation,
  mergeQaFaultsForConversation,
  parseQaFaultHeader,
} from "@/lib/qa/faults";
import { createTextDeltaCoalescer, formatSse, SSE_HEARTBEAT } from "./sse";
import { SSE_HEARTBEAT_MS } from "./constants";
import type { MessageMetadata } from "./types";
import type {
  FashionRouterResult,
  MessageFashionRouterMetaV1,
} from "@/lib/fashion-memory/router/types";
import { runOptionPreviews } from "./schedule-option-previews";
import { loadBuyerCatalogContext } from "./buyer-catalog/search-hints";

export type FashionChatStreamMode = "send" | "edit" | "regenerate";

export type FashionChatPostBody = {
  conversationId?: string;
  /** Default 'send'. Edit/regenerate reuse the same fashion pipeline. */
  mode?: FashionChatStreamMode;
  message?: string;
  /** edit: latest user message id. regenerate: latest assistant message id. */
  targetMessageId?: string;
  guestFashionMemory?: GuestFashionMemorySnapshot;
  fashionClarificationMessageId?: string;
  fashionClarificationAnswers?: Record<
    string,
    { selected: string[]; customText?: string }
  >;
};

function routerMetadata(
  result: FashionRouterResult,
  extras?: {
    traceId?: string;
    declinedGaps?: MessageFashionRouterMetaV1["declined_gaps"];
  },
): MessageFashionRouterMetaV1 {
  if (result.move === "respond_off_topic") {
    return {
      version: 1,
      move: "respond_off_topic",
      reply: result.reply,
      trace_id: extras?.traceId,
    };
  }
  if (result.move === "ask_clarification") {
    const questions = ensureQuestionsHaveQuickOptions(result.questions);
    return {
      version: 1,
      move: "ask_clarification",
      reply: result.reply,
      questions,
      ride_along: result.ride_along,
      stated_facts: result.stated_facts,
      brief: result.brief,
      target_person_id: result.target_person_id,
      declined_gaps: extras?.declinedGaps,
      status: "pending",
      expectsOptionPreviews: fashionRouterExpectsOptionPreviews({
        questions,
        ride_along: result.ride_along,
      }),
      trace_id: extras?.traceId,
      ...(result.known_summary ? { known_summary: result.known_summary } : {}),
      ...(result.escape_chip ? { escape_chip: result.escape_chip } : {}),
    };
  }
  return {
    version: 1,
    move: "ready_to_search",
    brief: result.brief,
    stated_facts: result.brief.stated_facts,
    declined_gaps: extras?.declinedGaps,
    trace_id: extras?.traceId,
    ...(result.known_summary ? { known_summary: result.known_summary } : {}),
  };
}

function assistantContent(result: FashionRouterResult): string {
  if (result.move === "ready_to_search") {
    const going = result.known_summary?.trim();
    const rest =
      safeTrim(result.brief.style_direction) ||
      safeTrim(result.brief.garments[0]) ||
      "Searching the catalog for you.";
    return going ? `${going} — pulling now.` : rest;
  }
  if (result.move === "ask_clarification") {
    // Questions render in FashionRouterControls — keep content to reply only
    // so the user does not see each question twice.
    return safeTrim(result.reply) || "Quick one before I search.";
  }
  return safeTrim(result.reply) || "Tell me a bit more — what are you shopping for?";
}

export function createFashionChatSseStream(params: {
  body: FashionChatPostBody;
  signal?: AbortSignal;
  userId: string;
  qaFaultsHeader?: string | null;
  /** E2E/test hooks — inject LLM + curation without env patching. */
  testHooks?: {
    routerDeps?: import("@/lib/fashion-memory/router/llm-router").RunFashionRouterDeps;
    plannerDeps?: import("@/lib/fashion-memory/search-planner/llm-planner").RunSearchPlannerDeps;
    createMessage?: import("@/lib/fashion-memory/catalog-search/types").SearchFashionCatalogPlanParams["createMessage"];
    resolveCurationMessage?: import("@/lib/fashion-memory/catalog-search/types").SearchFashionCatalogPlanParams["resolveCurationMessage"];
  };
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const userId = params.userId;
  const mode: FashionChatStreamMode = params.body.mode ?? "send";
  const guestFashionSnapshot: GuestFashionMemorySnapshot | undefined =
    isGuestUserId(userId)
      ? params.body.guestFashionMemory
        ? structuredClone(params.body.guestFashionMemory)
        : emptyGuestFashionMemorySnapshot()
      : undefined;

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

      const heartbeat = setInterval(() => push(SSE_HEARTBEAT), SSE_HEARTBEAT_MS);
      const coalescer = createTextDeltaCoalescer(push);
      const narrateFashion = (
        line: string | null,
        previewImages?: string[],
        droppedImages?: string[],
      ) => {
        if (
          !line &&
          !previewImages?.length &&
          !droppedImages?.length
        ) {
          return;
        }
        push(
          formatSse("narration_line", {
            ...(line ? { line } : {}),
            ...(previewImages?.length ? { previewImages } : {}),
            ...(droppedImages?.length ? { droppedImages } : {}),
          }),
        );
      };
      let extractionSpawn: {
        conversationId: string;
        userMessageId: string;
        traceId: string;
      } | null = null;
      let traceId: string | null = null;
      const turnStarted = Date.now();
      let activeConversationId: string | null = null;

      try {
        if ((mode === "send" || mode === "edit") && !params.body.message?.trim()) {
          push(formatSse("error", { message: "Message is required." }));
          push(formatSse("done", { status: "failed" }));
          return;
        }
        if ((mode === "edit" || mode === "regenerate") && !params.body.targetMessageId) {
          push(formatSse("error", { message: "targetMessageId is required." }));
          push(formatSse("done", { status: "failed" }));
          return;
        }

        const ensured = await ensureConversationForUser({
          conversationId: params.body.conversationId,
          userId,
        });
        const conv = ensured;
        activeConversationId = conv.id;
        mergeQaFaultsForConversation(
          conv.id,
          parseQaFaultHeader(params.qaFaultsHeader ?? null),
        );
        enterQaConversation(conv.id);
        push(
          formatSse("conversation", {
            conversationId: conv.id,
            shippingCountry: conv.shippingCountry,
            currency: conv.currency,
          }),
        );

        const [, activeBranchId, openedTraceId] = await Promise.all([
          skipPendingClarificationsForConversation(conv.id, {
            fashionClarificationMessageId:
              params.body.fashionClarificationMessageId,
            fashionClarificationAnswers: params.body.fashionClarificationAnswers,
          }),
          getOrCreateActiveBranchId(conv.id, conv.title),
          openFashionTrace({
            userId,
            conversationId: conv.id,
          }),
        ]);
        traceId = openedTraceId;
        beginTurnPipelineBuffer(traceId);

        let query: string;
        let turnUserMessageId: string;

        if (mode === "regenerate") {
          const targetId = params.body.targetMessageId!;
          const target = await prisma.message.findUnique({
            where: { id: targetId },
            select: { id: true, role: true, conversationId: true },
          });
          if (
            !target ||
            target.conversationId !== conv.id ||
            target.role !== "assistant"
          ) {
            throw new Error("Target message is not a regenerable assistant message.");
          }
          const newest = await prisma.message.findFirst({
            where: { conversationId: conv.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          if (newest?.id !== target.id) {
            throw new Error("Only the latest assistant reply can be regenerated.");
          }
          await prisma.message.delete({ where: { id: target.id } });

          const latestUser = await prisma.message.findFirst({
            where: { conversationId: conv.id, role: "user", status: "completed" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, content: true },
          });
          if (!latestUser) {
            throw new Error("No prior user message to regenerate from.");
          }
          query = latestUser.content;
          turnUserMessageId = latestUser.id;
        } else if (mode === "edit") {
          const targetId = params.body.targetMessageId!;
          const newText = params.body.message!.trim();
          const target = await prisma.message.findUnique({
            where: { id: targetId },
            select: {
              id: true,
              role: true,
              conversationId: true,
              content: true,
            },
          });
          if (
            !target ||
            target.conversationId !== conv.id ||
            target.role !== "user"
          ) {
            throw new Error("Target message is not an editable user message.");
          }
          const latestUser = await prisma.message.findFirst({
            where: { conversationId: conv.id, role: "user" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          if (latestUser?.id !== target.id) {
            throw new Error("Only the latest user message can be edited.");
          }

          await prisma.$transaction([
            prisma.messageVersion.create({
              data: { messageId: target.id, content: target.content },
            }),
            prisma.message.update({
              where: { id: target.id },
              data: { content: newText, status: "completed" },
            }),
          ]);
          await deleteMessagesStrictlyAfter(conv.id, target.id);

          push(
            formatSse("user_message", {
              messageId: target.id,
              edited: true,
              content: newText,
            }),
          );

          query = newText;
          turnUserMessageId = target.id;
        } else {
          const rawQuery = params.body.message!.trim();

          const priorMessage = await prisma.message.findFirst({
            where: { conversationId: conv.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { role: true, content: true },
          });

          if (
            isConsecutiveDuplicateUserTurn({
              priorRole: priorMessage?.role,
              priorContent: priorMessage?.content,
              newContent: rawQuery,
            })
          ) {
            recordPipelineEvent({
              traceId,
              stage: "dedupe",
              payload: {
                message: rawQuery,
                reason: "consecutive_duplicate_user_turn",
              },
            });
            drainTurnPipelineBuffer(traceId);
            closeFashionTrace({
              traceId,
              status: "complete",
              summary: { route: "dedupe_skipped", trace_id: traceId },
            });
            push(
              formatSse("done", {
                conversationId: conv.id,
                status: "completed",
                finishReason: "duplicate_message_skipped",
              }),
            );
            return;
          }

          const userRow = await prisma.message.create({
            data: {
              conversationId: conv.id,
              role: "user",
              content: rawQuery,
              status: "completed",
              branchId: activeBranchId,
              ...(clarificationAnswersAreTaps(
                params.body.fashionClarificationAnswers,
              )
                ? { metadata: { fashionChipTap: true } }
                : {}),
            },
          });
          void anchorBootstrapBranchIfNeeded(conv.id, userRow.id);
          push(formatSse("user_message", { messageId: userRow.id }));

          query = rawQuery;
          turnUserMessageId = userRow.id;
        }

        if (mode !== "regenerate") {
          extractionSpawn = {
            conversationId: conv.id,
            userMessageId: turnUserMessageId,
            traceId,
          };
        }

        const routerContext = await assembleRouterContext({
          conversationId: conv.id,
          userId,
          guestSnapshot: guestFashionSnapshot,
        });

        recordPipelineEvent({
          traceId,
          stage: "router_context",
          payload: {
            roster: routerContext.roster.slice(0, 400),
            profiles: routerContext.profiles.slice(0, 800),
            current_date: routerContext.currentDate,
            message_count: routerContext.conversationMessages.length,
            person_short_ids: Object.keys(routerContext.personShortIds),
          },
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

        // First progress before the router LLM — kill the silent "Generating…" gap.
        push(
          formatSse("fashion_pipeline", {
            phase: "started",
            conversationId: conv.id,
          }),
        );
        narrateFashion("Reading what you asked for");

        const resolved = await resolveFashionRouterTurn({
          conversationId: conv.id,
          userId,
          routerContext,
          guestSnapshot: guestFashionSnapshot,
          signal: params.signal,
          traceId,
          lastUserMessage: query,
          deps: params.testHooks?.routerDeps,
        });

        let routerResult = resolved.routerResult;

        let content = assistantContent(routerResult);
        let earlySearchTextFlushed = false;
        if (routerResult.move === "ready_to_search") {
          narrateFashion("Planning the search angles");
          // TTFT: style direction lands while planner/catalog run.
          coalescer.enqueue(content);
          coalescer.flush();
          earlySearchTextFlushed = true;
        } else {
          push(
            formatSse("fashion_pipeline", {
              phase: "complete",
              conversationId: conv.id,
            }),
          );
          coalescer.enqueue(content);
          coalescer.flush();
        }

        const fashionRouter = routerMetadata(routerResult, {
          traceId: traceId ?? undefined,
          declinedGaps: resolved.declinedGaps,
        });
        let metadata: MessageMetadata = {
          fashionRouter,
        };

        if (routerResult.move === "ready_to_search") {
          checkBriefInvariants({
            traceId,
            messages: routerContext.conversationMessages,
            brief: routerResult.brief,
          });
        }

        if (resolved.pendingBrief && !resolved.clearPendingBrief) {
          metadata.fashionPendingBrief = resolved.pendingBrief;
        }

        if (routerResult.move === "ready_to_search") {
          let resolvedRecipientId = resolved.recipientPersonId;
          if (!resolvedRecipientId && isSupabaseAuthUserId(userId)) {
            resolvedRecipientId = (await ensureSelfPerson(userId)).id;
          }

          if (resolvedRecipientId) {
            const attributes = {
              ...requestAttributesFromBrief(routerResult.brief),
              search_id: assistantRow.id,
            };
            scheduleDetachedWork(() => {
              void writeRequestEventFromBrief({
                userId,
                conversationId: conv.id,
                personId: resolvedRecipientId,
                attributes,
                guestSnapshot: guestFashionSnapshot,
              }).catch((err) => {
                logAiChat("warn", "fashion_brief_request_event_failed", {
                  error: String(err),
                  conversationId: conv.id,
                });
              });
            });

            if (isGuestUserId(userId)) {
              push(
                formatSse("fashion_request_event", {
                  version: 1,
                  conversationId: conv.id,
                  query,
                  attributes,
                  recipientPersonId: resolvedRecipientId,
                }),
              );
            }

            const skipPlanner =
              resolved.refinement?.mode === "rescore-only" &&
              resolved.refinement.previousPlan != null;
            const [planned, catalogProfile, catalogToken] = await Promise.all([
              skipPlanner
                ? Promise.resolve({
                    plan: {
                      ...resolved.refinement!.previousPlan!,
                      brief: routerResult.brief,
                    },
                    planner_ms: 0,
                    recipientProfile: "",
                  })
                : planSearchFromBrief({
                brief: routerResult.brief,
                userId,
                recipientPersonId: resolvedRecipientId,
                currentDate: routerContext.currentDate,
                guestSnapshot: guestFashionSnapshot,
                signal: params.signal,
                traceId,
                plannerDeps: params.testHooks?.plannerDeps,
              }),
              loadFashionSearchProfile({
                userId,
                recipientPersonId: resolvedRecipientId,
                conversationId: conv.id,
                guestSnapshot: guestFashionSnapshot,
              }),
              accessTokenForCatalogMcp(),
            ]);
            const searchPlan = planned.plan;
            const recipientProfile = planned.recipientProfile;

            metadata.fashionSearchPlan = fashionSearchPlanToMetadata(searchPlan, {
              trace_id: traceId ?? undefined,
            });

            push(
              formatSse("fashion_search_plan", {
                version: 1,
                conversationId: conv.id,
                plan: searchPlan,
              }),
            );

            const slotCount = searchPlan.slots.length;
            const queryLabel =
              searchPlan.brief.garments[0]?.trim() ||
              searchPlan.brief.style_direction?.trim() ||
              routerResult.brief.garments[0]?.trim() ||
              "your look";
            narrateFashion(
              slotCount === 1
                ? `Searching stores for “${queryLabel}”`
                : `Searching stores across ${slotCount} angles for “${queryLabel}”`,
            );

            const skipBudgetRaiseAsk = isGapDeclined(resolved.declinedGaps, {
              gap: "budget",
              person_id: resolvedRecipientId,
            });
            const catalogSearch = await searchFashionCatalogPlan({
              plan: searchPlan,
              profile: catalogProfile,
              accessToken: catalogToken,
              recipientFacts: resolved.recipientFacts,
              recipientProfile,
              signal: params.signal,
              traceId,
              searchId: assistantRow.id,
              userId,
              guestSnapshot: guestFashionSnapshot,
              skipBudgetRaiseAsk,
              ...(resolved.refinement?.mode &&
              resolved.refinement.mode !== "full" &&
              resolved.refinement.previousSearchId
                ? {
                    refinement: {
                      mode: resolved.refinement.mode,
                      previousSearchId: resolved.refinement.previousSearchId,
                    },
                  }
                : {}),
              onPhase: (phase) =>
                narrateFashion(
                  phase.line ?? null,
                  phase.previewImages,
                  phase.droppedImages,
                ),
              onProvisional: async ({ curation }) => {
                try {
                  // Hydration preview only — do not try-on or show looks until Stage A.
                  const render = buildRenderContract({
                    presentation: curation,
                    plan: searchPlan,
                  });
                  const provisionalMeta: MessageFashionCatalogSearchMetaV1 = {
                    version: 1,
                    slots: [],
                    timing_ms: Date.now() - turnStarted,
                    curation: {
                      version: 1 as const,
                      ...curation,
                      trace_id: traceId ?? undefined,
                    },
                    render,
                    provisional: true,
                    trace_id: traceId ?? undefined,
                  };
                  metadata.fashionCatalogSearch = provisionalMeta;
                  push(
                    formatSse("fashion_catalog_search", {
                      version: 1,
                      conversationId: conv.id,
                      catalogSearch: provisionalMeta,
                      provisional: true,
                    }),
                  );
                } catch (err) {
                  logAiChat("warn", "fashion_provisional_render_failed", {
                    error: String(err).slice(0, 200),
                    conversationId: conv.id,
                  });
                }
              },
              createMessage: params.testHooks?.createMessage,
              resolveCurationMessage: params.testHooks?.resolveCurationMessage,
            });
            let catalogMeta = fashionCatalogSearchToMetadata(catalogSearch, {
              trace_id: traceId ?? undefined,
            });
            if (catalogMeta.search_observability) {
              catalogMeta.search_observability.latency.planner_ms =
                planned.planner_ms;
              const prov =
                catalogMeta.search_observability.latency.total_to_provisional_ms;
              if (prov != null) {
                catalogMeta.search_observability.latency.total_to_provisional_ms =
                  prov + planned.planner_ms;
              }
            }
            // Ship curated rack immediately; try-on upgrades in parallel with reply text.
            let tryonUpgrade: Promise<void> | null = null;
            if (catalogSearch.curation) {
              const renderStarted = Date.now();
              catalogMeta = {
                ...catalogMeta,
                render: buildRenderContract({
                  presentation: catalogSearch.curation,
                  plan: searchPlan,
                }),
              };
              if (catalogMeta.search_observability) {
                catalogMeta.search_observability.latency.render_ms =
                  Date.now() - renderStarted;
              }
              metadata.fashionCatalogSearch = catalogMeta;
              push(
                formatSse("fashion_catalog_search", {
                  version: 1,
                  conversationId: conv.id,
                  catalogSearch: catalogMeta,
                }),
              );
              push(
                formatSse("fashion_pipeline", {
                  phase: "complete",
                  conversationId: conv.id,
                }),
              );
              const curationForTryon = catalogSearch.curation;
              tryonUpgrade = buildRenderContractWithTryon({
                presentation: curationForTryon,
                plan: searchPlan,
                userId,
              })
                .then((render) => {
                  catalogMeta = { ...catalogMeta, render };
                  metadata.fashionCatalogSearch = catalogMeta;
                  push(
                    formatSse("fashion_catalog_search", {
                      version: 1,
                      conversationId: conv.id,
                      catalogSearch: catalogMeta,
                    }),
                  );
                })
                .catch((err) => {
                  logAiChat("warn", "fashion_final_tryon_attach_failed", {
                    error: String(err).slice(0, 200),
                    conversationId: conv.id,
                  });
                });
            } else {
              metadata.fashionCatalogSearch = catalogMeta;
              push(
                formatSse("fashion_catalog_search", {
                  version: 1,
                  conversationId: conv.id,
                  catalogSearch: catalogMeta,
                }),
              );
              push(
                formatSse("fashion_pipeline", {
                  phase: "complete",
                  conversationId: conv.id,
                }),
              );
            }

            if (catalogSearch.budget_raise_ask) {
              const ask = catalogSearch.budget_raise_ask;
              routerResult = {
                move: "ask_clarification",
                reply: ask.reply,
                questions: ensureQuestionsHaveQuickOptions(ask.questions),
                target_person_id: resolvedRecipientId,
              };
              metadata.fashionRouter = routerMetadata(routerResult, {
                traceId: traceId ?? undefined,
                declinedGaps: resolved.declinedGaps,
              });
              content = assistantContent(routerResult);
              coalescer.enqueue(
                earlySearchTextFlushed ? `\n\n${content}` : content,
              );
              coalescer.flush();
              logAiChat("info", "fashion_budget_raise_ask_streamed", {
                conversationId: conv.id,
                traceId,
                reason: ask.reason,
                stated_max: ask.stated_max,
                min_viable_total: ask.min_viable_total,
              });
            } else {
              if (!earlySearchTextFlushed) {
                coalescer.enqueue(content);
                coalescer.flush();
              }

              // HARD RULE: stated brand outcome must appear in the reply.
              if (catalogSearch.brand_narration?.trim()) {
                const brandLine = catalogSearch.brand_narration.trim();
                content = `${content}\n\n${brandLine}`;
                coalescer.enqueue(`\n\n${brandLine}`);
                coalescer.flush();
              }

              if (catalogSearch.curation?.narration.opening?.trim()) {
                const curation = catalogSearch.curation;
                const degraded =
                  curation.meta.fallback ||
                  (curation.meta.thin_slots?.length ?? 0) > 0;
                const opening = curation.narration.opening.trim();
                const thinNote = curation.narration.thin_note?.trim();
                // Prefer honest thin/fallback copy over a success opening.
                const line =
                  degraded && thinNote
                    ? thinNote
                    : degraded && /fitting room|strongest verified/i.test(opening)
                      ? "Partial verified shortlist — not a finished fitting room."
                      : opening;
                content = `${content}\n\n${line}`;
                coalescer.enqueue(`\n\n${line}`);
                coalescer.flush();
                push(
                  formatSse("fashion_curation", {
                    version: 1,
                    conversationId: conv.id,
                    curation: catalogSearch.curation,
                  }),
                );
              }
            }

            // Try-on may still be attaching — wait briefly so persist/done include it when fast.
            if (tryonUpgrade) {
              await tryonUpgrade;
            }
          } else {
            // Never surface ready_to_search without a resolvable recipient.
            logAiChat("warn", "fashion_ready_without_recipient", {
              conversationId: conv.id,
              traceId,
            });
            routerResult = {
              move: "ask_clarification",
              reply: "Who is this for — you, or someone else?",
              questions: [
                {
                  text: "Who is this for?",
                  gap: "recipient",
                  quick_options: ["Me", "Someone else", "Other"],
                },
              ],
            };
            metadata.fashionRouter = routerMetadata(routerResult, {
              traceId: traceId ?? undefined,
              declinedGaps: resolved.declinedGaps,
            });
            content = assistantContent(routerResult);
            coalescer.enqueue(`\n\n${content}`);
            coalescer.flush();
          }

          if (routerResult.move === "ready_to_search") {
            push(
              formatSse("fashion_brief", {
                version: 1,
                conversationId: conv.id,
                brief: routerResult.brief,
              }),
            );
          }
        }

        const fashionRouterOut = metadata.fashionRouter!;
        push(
          formatSse("fashion_router", {
            conversationId: conv.id,
            move: fashionRouterOut.move,
            reply: fashionRouterOut.reply,
            questions: fashionRouterOut.questions,
            ride_along: fashionRouterOut.ride_along,
            brief: fashionRouterOut.brief,
            target_person_id: fashionRouterOut.target_person_id,
            expectsOptionPreviews:
              fashionRouterOut.expectsOptionPreviews ?? false,
          }),
        );

        const pipelineEvents = drainTurnPipelineBuffer(traceId);
        const searchCost = drainTurnLlmCostBuffer(traceId);
        metadata.fashionPipelineEvents = pipelineEvents;
        if (metadata.fashionCatalogSearch?.search_observability) {
          metadata.fashionCatalogSearch.search_observability.cost = searchCost;
          metadata.searchObservability =
            metadata.fashionCatalogSearch.search_observability;
        }

        await persistAssistantFinal({
          messageId: assistantRow.id,
          content,
          status: "completed",
          model: conv.model,
          finishReason: "fashion_router",
          metadata,
        });
        await touchConversationUpdatedAt(conv.id);

        // Clarification previews: don't hold `done` — client polls DB; SSE push is best-effort.
        if (fashionRouterOut.move === "ask_clarification") {
          const previewOptions = collectFashionPreviewRequests(fashionRouterOut);
          const paletteOptions = collectFashionPaletteRequests(fashionRouterOut);
          if (
            fashionRouterOut.expectsOptionPreviews ||
            paletteOptions.length > 0
          ) {
            let fashionRouterState = fashionRouterOut;
            scheduleDetachedWork(() => {
              void runOptionPreviews({
                messageId: assistantRow.id,
                conversationId: conv.id,
                userId,
                options: previewOptions,
                paletteOptions,
                getBuyerContext: () =>
                  loadBuyerCatalogContext(userId, "", conv.id).catch(() => null),
                fallbackShippingCountry: conv.shippingCountry,
                push,
                applyPreviews: (previewMap) => {
                  const merged = mergeOptionPreviewsIntoFashionRouter(
                    fashionRouterState,
                    previewMap,
                  );
                  fashionRouterState = merged;
                  metadata.fashionRouter = merged;
                  return { fashionRouter: merged };
                },
                applyPalettes: (paletteMap) => {
                  const merged = mergeOptionPalettesIntoFashionRouter(
                    fashionRouterState,
                    paletteMap,
                  );
                  fashionRouterState = merged;
                  metadata.fashionRouter = merged;
                  return { fashionRouter: merged };
                },
              });
            });
          }
        }

        const isFirstTurn = !params.body.conversationId;
        if (isFirstTurn) kickConversationTitleRename(conv.id);

        logAiChat("info", "fashion_chat_router_completed", {
          conversationId: conv.id,
          move: routerResult.move,
          traceId,
          clarification_gaps:
            routerResult.move === "ask_clarification"
              ? routerResult.questions.map((q) => q.gap)
              : undefined,
          sizes_unconfirmed: resolved.sizesUnconfirmed,
          recipient_person_id: resolved.recipientPersonId,
          declined_gaps: resolved.declinedGaps,
        });

        const totalHits =
          metadata.fashionCatalogSearch?.slots.reduce(
            (n, s) => n + (s.counts?.unique_products ?? 0),
            0,
          ) ?? 0;

        closeFashionTrace({
          traceId,
          status: "complete",
          summary: {
            route: routerResult.move,
            mode:
              routerResult.move === "ready_to_search"
                ? metadata.fashionSearchPlan?.mode
                : undefined,
            slots: metadata.fashionSearchPlan?.slots.length,
            total_hits: totalHits,
            total_ms: Date.now() - turnStarted,
            trace_id: traceId ?? undefined,
          },
        });

        if (guestFashionSnapshot) {
          push(
            formatSse("fashion_memory_snapshot", {
              version: 1,
              snapshot: guestFashionSnapshot,
            }),
          );
        }

        push(
          formatSse("done", {
            messageId: assistantRow.id,
            conversationId: conv.id,
            status: "completed",
            finishReason: "fashion_router",
            isFirstTurn,
            content,
            metadata,
          }),
        );
      } catch (error) {
        drainTurnPipelineBuffer(traceId);
        const err = error instanceof Error ? error : new Error(String(error));
        markFashionTraceError(traceId);
        logAiChat("error", "fashion_chat_router_failed", {
          error: err.message,
          stack: err.stack?.slice(0, 500),
        });
        push(formatSse("error", { message: "Fashion chat failed." }));
        push(formatSse("done", { status: "failed" }));
      } finally {
        if (activeConversationId) {
          clearQaFaultsForConversation(activeConversationId);
        }
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        if (extractionSpawn && isSupabaseAuthUserId(userId)) {
          spawnDetachedFashionExtraction({
            userId,
            conversationId: extractionSpawn.conversationId,
            triggerMessageId: extractionSpawn.userMessageId,
            traceId: extractionSpawn.traceId,
          });
        }
      }
    },
  });
}
