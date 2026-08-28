import { randomUUID } from "node:crypto";
import { buildRouterContextFromData } from "@/lib/fashion-memory/router/router-context-format";
import { resolveFashionRouterTurn } from "@/lib/fashion-memory/intake/post-router";
import { pendingBriefMeta } from "@/lib/fashion-memory/intake/pending-brief";
import {
  beginTurnPipelineBuffer,
  drainTurnPipelineBuffer,
} from "@/lib/fashion-memory/observability/trace";
import type {
  FashionRouterResult,
  FashionSearchBrief,
  MessageFashionRouterMetaV1,
} from "@/lib/fashion-memory/router/types";
import type { GuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import type { InMemoryPrismaStore } from "../../../../e2e/harness/in-memory-prisma";
import { seedE2eConversation } from "../../../../e2e/harness/persist-turn";
import type { FashionTurnMessage } from "@/lib/fashion-memory/extraction/message-window";
import type { RequestEventRow } from "@/lib/fashion-memory/types";
import type { Persona } from "./persona";
import { patienceRounds } from "./persona";
import { seedPersonaSnapshot } from "./seed-profile";
import { runLiveCatalogSearch } from "./live-search";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";
import { classifyRefinementMode, familyDiff } from "@/lib/fashion-memory/intake/refinement-mode";
import {
  detectShopperLeak,
  detectSlotsChecklistInconsistency,
  gapsFromQuestions,
  generateShopperReply,
} from "./shopper";

export type EvalStage = "router" | "full";

const CATALOG_STAGES = new Set([
  "ucp_query",
  "ucp_coverage",
  "catalog_query_failed",
  "catalog_slot_failed",
  "catalog_search",
]);

export type TranscriptTurn = {
  role: "user" | "assistant";
  content: string;
  router?: FashionRouterResult;
  at: string;
};

/** Client-visible ready-to-search line — never "(ready to search)". */
export function formatReadyToSearchContent(params: {
  known_summary?: string | null;
  reply?: string | null;
  pull_line?: string | null;
}): string {
  const progress = "Searching the stores";
  const pull = params.pull_line?.trim();
  if (pull && !/\(ready to search\)/i.test(pull) && !/^going on:/i.test(pull)) {
    return `${pull}\n${progress}`;
  }
  const spoken = params.reply?.trim();
  if (spoken && !/\(ready to search\)/i.test(spoken) && !/^going on:/i.test(spoken)) {
    return `${spoken}\n${progress}`;
  }
  const summary = params.known_summary?.trim() || "";
  // known_summary only when a profile fact exists — never bare log dump alone.
  if (summary && !/^going on:/i.test(summary)) {
    return `${summary}\n${progress}`;
  }
  if (spoken && !/\(ready to search\)/i.test(spoken)) {
    return `${spoken}\n${progress}`;
  }
  return progress;
}

/** True when the stylist spoke (ask / off-topic), not only a search progress line. */
export function transcriptHasSpokenStylistTurn(
  transcript: TranscriptTurn[],
): boolean {
  return transcript.some((t) => {
    if (t.role !== "assistant" || !t.router) return false;
    if (t.router.move === "ask_clarification") return true;
    if (t.router.move === "respond_off_topic") return true;
    return false;
  });
}

export type PersonaRunResult = {
  persona: Persona;
  stage: EvalStage;
  transcript: TranscriptTurn[];
  brief: FashionSearchBrief | null;
  shopper_leak: { fact: string; evidence: string } | null;
  excluded: boolean;
  question_rounds: number;
  impatient: boolean;
  traceId: string;
  conversationId: string;
  userId: string;
  error?: string;
  /** Two-visit golden: visit 1 transcript saved beside visit 2. */
  visit1_transcript?: TranscriptTurn[];
  duration_ms?: number;
  search_observability?: import("@/lib/fashion-memory/observability/search-observability").SearchObservability;
  lane_distribution?: import("./live-search").LaneCounts;
  scoring_weights_version?: string;
  refinement_mode?: import("@/lib/fashion-memory/intake/refinement-mode").RefinementMode;
  refinement_garments_unchanged?: boolean;
  refinement_latency_ms?: number | null;
  refinement_taste_cache_hits?: number;
  refinement_taste_calls?: number;
};

function eventsByPerson(
  snapshot: GuestFashionMemorySnapshot,
  userId: string,
): {
  lastRequestEventByPersonId: Map<string, RequestEventRow>;
  recentRequestEventsByPersonId: Map<string, RequestEventRow[]>;
} {
  const lastRequestEventByPersonId = new Map<string, RequestEventRow>();
  const recentRequestEventsByPersonId = new Map<string, RequestEventRow[]>();
  const byPerson = new Map<string, RequestEventRow[]>();
  for (const event of snapshot.request_events) {
    if (event.user_id !== userId) continue;
    const list = byPerson.get(event.person_id) ?? [];
    list.push(event);
    byPerson.set(event.person_id, list);
  }
  for (const [personId, events] of byPerson) {
    const sorted = [...events].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    recentRequestEventsByPersonId.set(personId, sorted.slice(0, 8));
    if (sorted[0]) lastRequestEventByPersonId.set(personId, sorted[0]);
  }
  return { lastRequestEventByPersonId, recentRequestEventsByPersonId };
}

function buildContext(
  snapshot: GuestFashionMemorySnapshot,
  userId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const self = snapshot.people.find((p) => p.relation === "self");
  const factsByPersonId = new Map<string, typeof snapshot.fashion_facts>();
  const signalsByPersonId = new Map<string, typeof snapshot.style_signals>();
  if (self) {
    factsByPersonId.set(
      self.id,
      snapshot.fashion_facts.filter((f) => f.person_id === self.id),
    );
    signalsByPersonId.set(
      self.id,
      snapshot.style_signals.filter((s) => s.person_id === self.id),
    );
  }
  const { lastRequestEventByPersonId, recentRequestEventsByPersonId } =
    eventsByPerson(snapshot, userId);
  return buildRouterContextFromData({
    people: snapshot.people.filter((p) => p.user_id === userId),
    factsByPersonId,
    signalsByPersonId,
    conversationMessages: messages,
    stickyPersonIds: self ? [self.id] : [],
    now: new Date(),
    accountHints: {
      genderPresentation:
        personaDept(snapshot) === "womens" ? "womens" : "mens",
      preferredName: self?.name ?? "Guest",
      sizeLines: [],
    },
    lastRequestEventByPersonId,
    recentRequestEventsByPersonId,
  });
}

function personaDept(snapshot: GuestFashionMemorySnapshot): string {
  const self = snapshot.people.find((p) => p.relation === "self");
  if (!self) return "mens";
  const fact = snapshot.fashion_facts.find(
    (f) => f.person_id === self.id && f.fact_type === "gender_presentation",
  );
  const val = fact?.value as { presentation?: string } | undefined;
  return val?.presentation ?? "mens";
}

function persistAssistantTurn(params: {
  store: InMemoryPrismaStore;
  conversationId: string;
  userId: string;
  content: string;
  router: FashionRouterResult;
  recipientPersonId: string | null;
  consultRounds?: 0 | 1 | 2;
}): FashionTurnMessage {
  const id = randomUUID();
  const createdAt = new Date();
  const meta: MessageFashionRouterMetaV1 = {
    version: 1,
    move: params.router.move,
    reply: "reply" in params.router ? params.router.reply : undefined,
    questions:
      params.router.move === "ask_clarification"
        ? params.router.questions
        : undefined,
    brief: "brief" in params.router ? params.router.brief : undefined,
    known_summary:
      "known_summary" in params.router
        ? params.router.known_summary
        : undefined,
    pull_line:
      "pull_line" in params.router ? params.router.pull_line : undefined,
    status: params.router.move === "ask_clarification" ? "pending" : undefined,
  };
  const metadata: Record<string, unknown> = { fashionRouter: meta };
  if (
    params.router.move === "ask_clarification" &&
    params.router.brief &&
    params.recipientPersonId
  ) {
    metadata.fashionPendingBrief = pendingBriefMeta(
      params.router.brief,
      params.recipientPersonId,
      { consult_rounds_used: params.consultRounds },
    );
  }
  params.store.messages.set(id, {
    id,
    conversationId: params.conversationId,
    role: "assistant",
    content: params.content,
    status: "completed",
    model: "eval",
    metadata,
    branchId: null,
    createdAt,
    updatedAt: createdAt,
    inputTokens: null,
    outputTokens: null,
    finishReason: null,
    error: null,
  });
  return {
    id,
    role: "assistant",
    content: params.content,
    metadata: metadata as FashionTurnMessage["metadata"],
    createdAt,
  };
}

export function persistEvalUserTurn(params: {
  store: InMemoryPrismaStore;
  conversationId: string;
  content: string;
}): FashionTurnMessage {
  const id = randomUUID();
  const createdAt = new Date();
  params.store.messages.set(id, {
    id,
    conversationId: params.conversationId,
    role: "user",
    content: params.content,
    status: "completed",
    model: null,
    metadata: null,
    branchId: null,
    createdAt,
    updatedAt: createdAt,
    inputTokens: null,
    outputTokens: null,
    finishReason: null,
    error: null,
  });
  return {
    id,
    role: "user",
    content: params.content,
    metadata: null,
    createdAt,
  };
}

export type AfterReadyToSearch = (ctx: {
  brief: FashionSearchBrief;
  searchId: string;
  snapshot: GuestFashionMemorySnapshot;
  userId: string;
  conversationId: string;
  turnMessages: FashionTurnMessage[];
  recipientPersonId: string | null;
  store: InMemoryPrismaStore;
  traceId: string;
}) => Promise<void>;

export async function runPersonaAppointment(params: {
  persona: Persona;
  stage: EvalStage;
  store: InMemoryPrismaStore;
  maxTurns?: number;
  userId?: string;
  conversationId?: string;
  snapshot?: GuestFashionMemorySnapshot;
  afterReadyToSearch?: AfterReadyToSearch;
}): Promise<PersonaRunResult> {
  const { persona, stage, store } = params;
  const maxTurns = params.maxTurns ?? 8;
  const userId = params.userId ?? `guest-eval-${persona.id}`;
  const conversationId =
    params.conversationId ?? `conv_eval_${persona.id}_${randomUUID().slice(0, 8)}`;
  const traceId = randomUUID();
  const started = Date.now();

  seedE2eConversation({ store, conversationId, userId });
  const snapshot =
    params.snapshot ?? seedPersonaSnapshot(persona, userId).snapshot;
  beginTurnPipelineBuffer(traceId);

  const transcript: TranscriptTurn[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const turnMessages: FashionTurnMessage[] = [];
  const askedGaps = new Set<string>();
  const discussedGarments = new Set<string>();
  for (const g of persona.truth.garments) {
    if (persona.opening_message.toLowerCase().includes(g.toLowerCase())) {
      discussedGarments.add(g.toLowerCase());
    }
  }

  let brief: FashionSearchBrief | null = null;
  let shopper_leak: PersonaRunResult["shopper_leak"] = null;
  let question_rounds = 0;
  let impatient = false;
  let lastAsk: Extract<
    FashionRouterResult,
    { move: "ask_clarification" }
  > | null = null;
  let error: string | undefined;
  let search_observability: PersonaRunResult["search_observability"];
  let lane_distribution: PersonaRunResult["lane_distribution"];
  let scoring_weights_version: string | undefined;
  let refinement_mode: PersonaRunResult["refinement_mode"];
  let refinement_garments_unchanged: boolean | undefined;
  let refinement_latency_ms: number | null | undefined;
  let refinement_taste_cache_hits: number | undefined;
  let refinement_taste_calls: number | undefined;
  let firstSearch: {
    searchId: string;
    brief: FashionSearchBrief;
    plan: FashionSearchPlan;
  } | null = null;

  const opening = persona.opening_message;
  messages.push({ role: "user", content: opening });
  transcript.push({
    role: "user",
    content: opening,
    at: new Date().toISOString(),
  });
  turnMessages.push(
    persistEvalUserTurn({ store, conversationId, content: opening }),
  );

  const assertNoCatalog = () => {
    if (stage !== "router") return;
    const events = drainTurnPipelineBuffer(traceId);
    beginTurnPipelineBuffer(traceId);
    const hit = events.find((e) => CATALOG_STAGES.has(e.stage));
    if (hit) {
      throw new Error(
        `router-stage catalog call logged: stage=${hit.stage} (retrieval must stay mocked)`,
      );
    }
  };

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const routerContext = buildContext(snapshot, userId, messages);
      const lastUser = messages.filter((m) => m.role === "user").at(-1)?.content;
      const resolved = await resolveFashionRouterTurn({
        conversationId,
        userId,
        routerContext,
        guestSnapshot: snapshot,
        traceId,
        lastUserMessage: lastUser,
      });
      assertNoCatalog();

      const router = resolved.routerResult;
      const assistantText =
        router.move === "respond_off_topic"
          ? router.reply
          : router.move === "ask_clarification"
            ? router.reply
            : formatReadyToSearchContent({
                known_summary: router.known_summary,
                reply:
                  router.move === "ready_to_search" ? router.reply : undefined,
                pull_line:
                  router.move === "ready_to_search"
                    ? router.pull_line
                    : undefined,
              });

      messages.push({ role: "assistant", content: assistantText });
      transcript.push({
        role: "assistant",
        content: assistantText,
        router,
        at: new Date().toISOString(),
      });
      const assistantTurn = persistAssistantTurn({
        store,
        conversationId,
        userId,
        content: assistantText,
        router,
        recipientPersonId: resolved.recipientPersonId,
        consultRounds: router.move === "ready_to_search"
          ? router.brief.consultation?.rounds_used
          : router.move === "ask_clarification"
            ? router.brief?.consultation?.rounds_used
            : undefined,
      });
      turnMessages.push(assistantTurn);

      if (router.move === "respond_off_topic") {
        // One more shopper nudge then stop if still off-topic next loop
        const reply = await generateShopperReply({
          persona,
          history: messages,
          routerAsk: null,
          questionRound: question_rounds,
          impatient,
          traceId,
        });
        messages.push({ role: "user", content: reply });
        transcript.push({
          role: "user",
          content: reply,
          at: new Date().toISOString(),
        });
        turnMessages.push(
          persistEvalUserTurn({ store, conversationId, content: reply }),
        );
        continue;
      }

      if (router.move === "ready_to_search") {
        brief = router.brief;
        if (stage === "full") {
          const searchId = randomUUID();
          const live = await runLiveCatalogSearch({
            brief: router.brief,
            userId,
            snapshot,
            recipientPersonId:
              resolved.recipientPersonId ??
              snapshot.people.find((p) => p.relation === "self")?.id ??
              "",
            recipientFacts: resolved.recipientFacts,
            traceId,
            currentDate: routerContext.currentDate,
            searchId,
          });
          search_observability = live.search_observability;
          lane_distribution = live.lane_distribution;
          scoring_weights_version = live.scoring_weights_version;
          if (live.plan) {
            firstSearch = {
              searchId,
              brief: router.brief,
              plan: live.plan,
            };
          }
          if (live.error) error = live.error;
        }
        if (params.afterReadyToSearch && brief) {
          await params.afterReadyToSearch({
            brief,
            searchId: assistantTurn.id,
            snapshot,
            userId,
            conversationId,
            turnMessages,
            recipientPersonId: resolved.recipientPersonId,
            store,
            traceId,
          });
        }
        if (persona.edge === "refines_after_results") {
            const refine = await generateShopperReply({
              persona,
              history: messages,
              routerAsk: null,
              resultsArrived: true,
              questionRound: question_rounds,
              impatient: false,
              traceId,
            });
            messages.push({ role: "user", content: refine });
            transcript.push({
              role: "user",
              content: refine,
              at: new Date().toISOString(),
            });
            turnMessages.push(
              persistEvalUserTurn({ store, conversationId, content: refine }),
            );
            const ctx2 = buildContext(snapshot, userId, messages);
            const resolved2 = await resolveFashionRouterTurn({
              conversationId,
              userId,
              routerContext: ctx2,
              guestSnapshot: snapshot,
              traceId,
              lastUserMessage: refine,
            });
            assertNoCatalog();
            const r2 = resolved2.routerResult;
            const text2 =
              r2.move === "ask_clarification" || r2.move === "respond_off_topic"
                ? r2.reply
                : formatReadyToSearchContent({
                    known_summary: r2.known_summary,
                    reply: r2.move === "ready_to_search" ? r2.reply : undefined,
                    pull_line:
                      r2.move === "ready_to_search" ? r2.pull_line : undefined,
                  });
            messages.push({ role: "assistant", content: text2 });
            transcript.push({
              role: "assistant",
              content: text2,
              router: r2,
              at: new Date().toISOString(),
            });
            if (r2.move === "ready_to_search") {
              brief = r2.brief;
              const prevGarments = firstSearch?.brief.garments ?? [];
              const diff = familyDiff(prevGarments, r2.brief.garments);
              refinement_garments_unchanged =
                diff.onlyPrev.length === 0 && diff.onlyNext.length === 0;
              refinement_mode = classifyRefinementMode(
                firstSearch?.brief,
                r2.brief,
              );
              if (stage === "full" && firstSearch) {
                const refineLive = await runLiveCatalogSearch({
                  brief: r2.brief,
                  userId,
                  snapshot,
                  recipientPersonId:
                    resolved2.recipientPersonId ??
                    snapshot.people.find((p) => p.relation === "self")?.id ??
                    "",
                  recipientFacts: resolved2.recipientFacts,
                  traceId,
                  currentDate: ctx2.currentDate,
                  searchId: randomUUID(),
                  previous: firstSearch,
                });
                refinement_mode =
                  refineLive.search_observability?.refinement_mode ??
                  refinement_mode;
                refinement_latency_ms =
                  refineLive.search_observability?.latency.total_to_final_ms ??
                  null;
                refinement_taste_cache_hits =
                  refineLive.search_observability?.taste_rerank?.cache_hits ?? 0;
                refinement_taste_calls =
                  refineLive.search_observability?.taste_rerank?.calls ?? 0;
                if (refineLive.error && !error) error = refineLive.error;
              }
            }
        }
        break;
      }

      // ask_clarification
      lastAsk = router;
      question_rounds += 1;
      for (const g of gapsFromQuestions(router.questions)) askedGaps.add(g);
      if (question_rounds > patienceRounds(persona.patience)) {
        impatient = true;
      }

      const reply = await generateShopperReply({
        persona,
        history: messages,
        routerAsk: lastAsk,
        questionRound: question_rounds,
        impatient,
        traceId,
      });

      const leak = detectShopperLeak({
        persona,
        reply,
        askedGaps,
        discussedGarments,
      });
      const slotsInconsistency =
        !leak && lastAsk
          ? (() => {
              const sq = lastAsk.questions.find((q) => q.gap === "slots");
              return sq
                ? detectSlotsChecklistInconsistency({
                    persona,
                    reply,
                    slotsQuestion: sq,
                  })
                : null;
            })()
          : null;
      if (leak || slotsInconsistency) {
        shopper_leak = leak ?? slotsInconsistency;
        messages.push({ role: "user", content: reply });
        transcript.push({
          role: "user",
          content: reply,
          at: new Date().toISOString(),
        });
        break;
      }

      for (const g of persona.truth.garments) {
        if (reply.toLowerCase().includes(g.toLowerCase())) {
          discussedGarments.add(g.toLowerCase());
        }
      }

      messages.push({ role: "user", content: reply });
      transcript.push({
        role: "user",
        content: reply,
        at: new Date().toISOString(),
      });
      turnMessages.push(
        persistEvalUserTurn({ store, conversationId, content: reply }),
      );
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    drainTurnPipelineBuffer(traceId);
  }

  return {
    persona,
    stage,
    transcript,
    brief,
    shopper_leak,
    excluded: Boolean(shopper_leak),
    question_rounds,
    impatient,
    traceId,
    conversationId,
    userId,
    error,
    duration_ms: Date.now() - started,
    search_observability,
    lane_distribution,
    scoring_weights_version,
    refinement_mode,
    refinement_garments_unchanged,
    refinement_latency_ms,
    refinement_taste_cache_hits,
    refinement_taste_calls,
  };
}
