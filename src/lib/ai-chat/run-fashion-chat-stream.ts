/**
 * Fashion chat router — one LLM call, three forced tools per turn.
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
import { isGapDeclined } from "@/lib/fashion-memory/intake/dodge-counter";
import { ensureQuestionsHaveQuickOptions } from "@/lib/fashion-memory/router/clarification-defaults";
import {
  fashionCatalogSearchToMetadata,
  loadFashionSearchProfile,
  searchFashionCatalogPlan,
} from "@/lib/fashion-memory/catalog-search";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { safeTrim } from "@/lib/fashion-memory/safe-trim";
import { buildFashionCatalogDebug } from "@/lib/fashion-memory/catalog-search/fashion-catalog-debug";
import { buildRenderContractWithTryon } from "@/lib/tryon/attach-render";
import { isAgentDebugEnabled } from "./agent-debug";
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
} from "@/lib/fashion-memory/observability";
import {
  clearQaFaultsForConversation,
  enterQaConversation,
  mergeQaFaultsForConversation,
  parseQaFaultHeader,
} from "@/lib/qa/faults";
import { createTextDeltaCoalescer, formatSse, SSE_HEARTBEAT } from "./sse";
import type { MessageMetadata, ShoppingModeMetaV1 } from "./types";
import type {
  FashionRouterResult,
  MessageFashionRouterMetaV1,
} from "@/lib/fashion-memory/router/types";

export type FashionChatPostBody = {
  conversationId?: string;
  message: string;
  guestFashionMemory?: GuestFashionMemorySnapshot;
  fashionClarificationMessageId?: string;
  fashionClarificationAnswers?: Record<string, string>;
};

function pushAgentDebug(
  push: (chunk: string) => void,
  event: {
    stage: string;
    label: string;
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
    data?: Record<string, unknown>;
  },
) {
  if (!isAgentDebugEnabled()) return;
  push(
    formatSse("agent_debug", {
      ts: Date.now(),
      stage: event.stage,
      label: event.label,
      conversationId: event.conversationId ?? null,
      userMessageId: event.userMessageId ?? null,
      assistantMessageId: event.assistantMessageId ?? null,
      data: event.data ?? null,
    }),
  );
}

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
    return {
      version: 1,
      move: "ask_clarification",
      reply: result.reply,
      questions: result.questions,
      ride_along: result.ride_along,
      stated_facts: result.stated_facts,
      target_person_id: result.target_person_id,
      declined_gaps: extras?.declinedGaps,
      status: "pending",
      // Legacy flat fields for older clients
      missing: result.questions.map((q) => q.gap),
      quick_options: result.questions[0]?.quick_options,
      trace_id: extras?.traceId,
    };
  }
  return {
    version: 1,
    move: "ready_to_search",
    brief: result.brief,
    stated_facts: result.brief.stated_facts,
    declined_gaps: extras?.declinedGaps,
    trace_id: extras?.traceId,
  };
}

function assistantContent(result: FashionRouterResult): string {
  if (result.move === "ready_to_search") {
    return (
      safeTrim(result.brief.style_direction) ||
      safeTrim(result.brief.garments[0]) ||
      "Searching the catalog for you."
    );
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
  const query = params.body.message?.trim() ?? "";
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

      const heartbeat = setInterval(() => push(SSE_HEARTBEAT), 15_000);
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
        if (!query) {
          push(formatSse("error", { message: "Message is required." }));
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

        await skipPendingClarificationsForConversation(conv.id, {
          fashionClarificationMessageId:
            params.body.fashionClarificationMessageId,
          fashionClarificationAnswers: params.body.fashionClarificationAnswers,
        });
        const activeBranchId = await getOrCreateActiveBranchId(
          conv.id,
          conv.title,
        );

        traceId = await openFashionTrace({
          userId,
          conversationId: conv.id,
        });
        beginTurnPipelineBuffer(traceId);

        const priorMessage = await prisma.message.findFirst({
          where: { conversationId: conv.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { role: true, content: true },
        });

        if (
          isConsecutiveDuplicateUserTurn({
            priorRole: priorMessage?.role,
            priorContent: priorMessage?.content,
            newContent: query,
          })
        ) {
          recordPipelineEvent({
            traceId,
            stage: "dedupe",
            payload: { message: query, reason: "consecutive_duplicate_user_turn" },
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
            content: query,
            status: "completed",
            branchId: activeBranchId,
          },
        });
        void anchorBootstrapBranchIfNeeded(conv.id, userRow.id);
        push(formatSse("user_message", { messageId: userRow.id }));
        extractionSpawn = {
          conversationId: conv.id,
          userMessageId: userRow.id,
          traceId,
        };

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

        const shoppingMode: ShoppingModeMetaV1 = {
          version: 1,
          mode: "judge",
          source: "user",
          reason: "fashion_router",
        };
        push(formatSse("mode_resolved", shoppingMode));

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
        if (routerResult.move === "ready_to_search") {
          push(
            formatSse("fashion_pipeline", {
              phase: "started",
              conversationId: conv.id,
            }),
          );
          narrateFashion("Planning your search");
        } else {
          coalescer.enqueue(content);
          coalescer.flush();
        }

        const fashionRouter = routerMetadata(routerResult, {
          traceId: traceId ?? undefined,
          declinedGaps: resolved.declinedGaps,
        });
        const metadata: MessageMetadata = {
          shoppingMode,
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
            const attributes = requestAttributesFromBrief(routerResult.brief);
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

            const searchPlan = await planSearchFromBrief({
              brief: routerResult.brief,
              userId,
              recipientPersonId: resolvedRecipientId,
              currentDate: routerContext.currentDate,
              guestSnapshot: guestFashionSnapshot,
              signal: params.signal,
              traceId,
              plannerDeps: params.testHooks?.plannerDeps,
            });

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
              `Exploring ${slotCount} angle${slotCount === 1 ? "" : "s"} for “${queryLabel}”`,
            );
            narrateFashion("Searching stores");

            const catalogProfile = await loadFashionSearchProfile({
              userId,
              recipientPersonId: resolvedRecipientId,
              conversationId: conv.id,
              guestSnapshot: guestFashionSnapshot,
            });
            const catalogToken = await accessTokenForCatalogMcp();
            const skipBudgetRaiseAsk = isGapDeclined(resolved.declinedGaps, {
              gap: "budget",
              person_id: resolvedRecipientId,
            });
            const catalogSearch = await searchFashionCatalogPlan({
              plan: searchPlan,
              profile: catalogProfile,
              accessToken: catalogToken,
              recipientFacts: resolved.recipientFacts,
              signal: params.signal,
              traceId,
              searchId: assistantRow.id,
              userId,
              guestSnapshot: guestFashionSnapshot,
              skipBudgetRaiseAsk,
              onPhase: (phase) =>
                narrateFashion(
                  phase.line ?? null,
                  phase.previewImages,
                  phase.droppedImages,
                ),
              createMessage: params.testHooks?.createMessage,
              resolveCurationMessage: params.testHooks?.resolveCurationMessage,
            });
            let catalogMeta = fashionCatalogSearchToMetadata(catalogSearch, {
              trace_id: traceId ?? undefined,
            });
            if (catalogSearch.curation) {
              catalogMeta = {
                ...catalogMeta,
                render: await buildRenderContractWithTryon({
                  presentation: catalogSearch.curation,
                  plan: searchPlan,
                  userId,
                }),
              };
            }
            metadata.fashionCatalogSearch = catalogMeta;

            push(
              formatSse("fashion_catalog_search", {
                version: 1,
                conversationId: conv.id,
                catalogSearch: metadata.fashionCatalogSearch,
              }),
            );
            push(
              formatSse("fashion_pipeline", {
                phase: "complete",
                conversationId: conv.id,
              }),
            );

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
              coalescer.enqueue(content);
              coalescer.flush();
              logAiChat("info", "fashion_budget_raise_ask_streamed", {
                conversationId: conv.id,
                traceId,
                reason: ask.reason,
                stated_max: ask.stated_max,
                min_viable_total: ask.min_viable_total,
              });
            } else {
              coalescer.enqueue(content);
              coalescer.flush();

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
                      ? thinNote ||
                        "Partial verified shortlist — not a finished fitting room."
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

            pushAgentDebug(push, {
              stage: "fashion_catalog",
              label: "Fashion catalog fan-out",
              conversationId: conv.id,
              userMessageId: userRow.id,
              assistantMessageId: assistantRow.id,
              data: buildFashionCatalogDebug(
                catalogSearch,
                Date.now(),
                traceId,
              ) as unknown as Record<string, unknown>,
            });

            if (catalogSearch.curation_debug) {
              pushAgentDebug(push, {
                stage: "fashion_curation",
                label: "Fashion curation",
                conversationId: conv.id,
                userMessageId: userRow.id,
                assistantMessageId: assistantRow.id,
                data: catalogSearch.curation_debug as unknown as Record<
                  string,
                  unknown
                >,
              });
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
            missing: fashionRouterOut.missing,
            quick_options: fashionRouterOut.quick_options,
            brief: fashionRouterOut.brief,
            target_person_id: fashionRouterOut.target_person_id,
          }),
        );

        const pipelineEvents = drainTurnPipelineBuffer(traceId);
        if (pipelineEvents.length) {
          metadata.fashionPipelineEvents = pipelineEvents;
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
