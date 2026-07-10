import { logAiChat } from "@/lib/ai-chat/observability";
import { isSupabaseAuthUserId } from "../auth";
import { listActiveFashionFacts } from "../facts";
import { ensureSelfPerson } from "../people";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { applyClarificationReplyFromMessage } from "./apply-intake-reply";
import { applyStatedFacts } from "./apply-stated-facts";
import { sanitizeClarificationQuestions } from "./clarification-sanitize";
import { buildKnowledgeState } from "./knowledge-state";
import {
  buildBlockingClarification,
  computeSizesUnconfirmed,
  garmentTypesForUnconfirmedBuckets,
  garmentsForIntakeGate,
  getGenderPresentation,
  hasSizeForBucket,
  missingSizeBucketsForGarments,
  needsDepartmentClarification,
  parseDepartmentFromMessage,
} from "./identity-gate";
import {
  countGapAsksSinceReset,
  filterQuestionsByDeclined,
  isGapDeclined,
  loadDeclinedGaps,
  type DeclinedGapKey,
} from "./dodge-counter";
import { reconcileBrandDirection, reconcileColorDirection, stripBrandsFromMustHaves } from "../router/brief-fields";
import {
  loadPendingBrief,
  pendingBriefMeta,
} from "./pending-brief";
import type { FashionPendingBriefMetaV1 } from "../router/types";
import {
  resolveBriefRecipientPersonId,
  runFashionRouter,
  type RunFashionRouterDeps,
} from "../router/llm-router";
import { ensureQuestionsHaveQuickOptions } from "../router/clarification-defaults";
import { buildFashionRouterPrompt } from "../router/prompt";
import type {
  FashionClarificationQuestion,
  FashionRouterContext,
  FashionRouterMove,
  FashionRouterResult,
  FashionSearchBrief,
  FashionStatedFacts,
} from "../router/types";
import type { FashionFactRow, PersonRow, StyleSignalRow } from "../types";
import { safeTrim } from "../safe-trim";
import { recordPipelineEvent } from "../observability/trace";
import { departmentFromRelation } from "../department";
import {
  intakeHintsForRecipient,
  loadIntakeProfileHints,
  type IntakeProfileHints,
} from "./account-profile-bridge";

function withClarificationDefaults(
  result: Extract<FashionRouterResult, { move: "ask_clarification" }>,
  traceId?: string | null,
): FashionRouterResult {
  return {
    ...result,
    questions: sanitizeClarificationQuestions({
      questions: ensureQuestionsHaveQuickOptions(result.questions),
      traceId,
    }),
  };
}

function filterQuestionsSatisfiedByFacts(params: {
  questions: FashionClarificationQuestion[];
  facts: FashionFactRow[];
  brief: Pick<FashionSearchBrief, "department_scope">;
  profileHints?: IntakeProfileHints | null;
}): FashionClarificationQuestion[] {
  const hasDept =
    Boolean(params.brief.department_scope) ||
    getGenderPresentation(params.facts) != null ||
    Boolean(params.profileHints?.genderPresentation);

  return params.questions.filter((q) => {
    if (q.gap === "department") return !hasDept;
    if (q.gap === "size") {
      const bucket = q.garment_type;
      if (!bucket) return true;
      return !hasSizeForBucket(
        params.facts,
        bucket as "tops" | "bottoms" | "shoes" | "dresses",
        params.profileHints,
      );
    }
    return true;
  });
}

function statedFactsFromRouterResult(
  result: FashionRouterResult,
): FashionStatedFacts | undefined {
  if (result.move === "ready_to_search") return result.brief.stated_facts;
  if (result.move === "ask_clarification") return result.stated_facts;
  return undefined;
}

function mergeDepartmentFromStatedFacts(
  brief: FashionSearchBrief,
  stated?: FashionStatedFacts,
): FashionSearchBrief {
  if (brief.department_scope || !stated?.department) return brief;
  return { ...brief, department_scope: stated.department };
}

function mergeBudgetFromStatedFacts(
  brief: FashionSearchBrief,
  stated?: FashionStatedFacts,
): FashionSearchBrief {
  if (stated?.budget?.max == null) return brief;
  if (brief.budget_context.stated && brief.budget_context.max != null) {
    return brief;
  }
  return {
    ...brief,
    budget_context: {
      stated: true,
      max: stated.budget.max,
      currency: stated.budget.currency ?? brief.budget_context.currency,
    },
  };
}
export type ResolvedFashionRouterOutcome = {
  routerResult: FashionRouterResult;
  pendingBrief: FashionPendingBriefMetaV1 | null;
  clearPendingBrief: boolean;
  recipientPersonId: string | null;
  recipientFacts: FashionFactRow[];
  sizesUnconfirmed: string[];
  declinedGaps: DeclinedGapKey[];
};

async function loadPeopleAndFacts(params: {
  userId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<{
  people: PersonRow[];
  factsByPersonId: Map<string, FashionFactRow[]>;
  signalsByPersonId: Map<string, StyleSignalRow[]>;
}> {
  if (isSupabaseAuthUserId(params.userId)) {
    const people = await import("../people").then((m) =>
      m.listPeopleForUser(params.userId),
    );
    const factsByPersonId = new Map<string, FashionFactRow[]>();
    const signalsByPersonId = new Map<string, StyleSignalRow[]>();
    await Promise.all(
      people.map(async (person) => {
        factsByPersonId.set(
          person.id,
          await listActiveFashionFacts({
            userId: params.userId,
            personId: person.id,
          }),
        );
        signalsByPersonId.set(
          person.id,
          await import("../signals").then((m) =>
            m.listActiveStyleSignals({
              userId: params.userId,
              personId: person.id,
            }),
          ),
        );
      }),
    );
    return { people, factsByPersonId, signalsByPersonId };
  }

  const snapshot = params.guestSnapshot ?? {
    version: 1 as const,
    people: [],
    fashion_facts: [],
    style_signals: [],
    request_events: [],
    extraction_runs: [],
  };
  const people = snapshot.people.filter((p) => p.user_id === params.userId);
  const factsByPersonId = new Map<string, FashionFactRow[]>();
  const signalsByPersonId = new Map<string, StyleSignalRow[]>();
  for (const person of people) {
    factsByPersonId.set(
      person.id,
      snapshot.fashion_facts.filter(
        (f) =>
          f.user_id === params.userId &&
          f.person_id === person.id &&
          f.status === "active",
      ),
    );
    signalsByPersonId.set(
      person.id,
      snapshot.style_signals.filter(
        (s) => s.user_id === params.userId && s.person_id === person.id,
      ),
    );
  }
  return { people, factsByPersonId, signalsByPersonId };
}

function personLabel(person: PersonRow | undefined): string {
  if (!person) return "you";
  const name = safeTrim(person.name);
  if (name) return name;
  if (person.relation === "self") return "you";
  return safeTrim(person.relation) || "them";
}

function applyDepartmentFromUserMessage(
  brief: FashionSearchBrief,
  lastUserMessage: string | undefined,
): FashionSearchBrief {
  if (brief.department_scope) return brief;
  const parsed = lastUserMessage ? parseDepartmentFromMessage(lastUserMessage) : null;
  if (!parsed) return brief;
  return { ...brief, department_scope: parsed };
}

function applyDepartmentFromRelation(
  brief: FashionSearchBrief,
  person: Pick<PersonRow, "relation"> | null | undefined,
): FashionSearchBrief {
  if (brief.department_scope) return brief;
  const inferred = departmentFromRelation(person?.relation);
  if (!inferred) return brief;
  return { ...brief, department_scope: inferred };
}

function finalizeBriefForSearch(params: {
  brief: FashionSearchBrief;
  person: PersonRow;
  facts: FashionFactRow[];
  signals: StyleSignalRow[];
  sizesUnconfirmed: string[];
  lastUserMessage?: string;
}): FashionSearchBrief {
  const color_direction = reconcileColorDirection({
    brief: params.brief,
    signals: params.signals,
    lastUserMessage: params.lastUserMessage,
  });
  const brand_direction = reconcileBrandDirection({
    brief: params.brief,
    signals: params.signals,
    lastUserMessage: params.lastUserMessage,
  });
  const must_haves =
    brand_direction.source === "stated" && brand_direction.brands?.length
      ? stripBrandsFromMustHaves(params.brief.must_haves, brand_direction.brands)
      : params.brief.must_haves;
  const knowledge_state = buildKnowledgeState({
    brief: params.brief,
    facts: params.facts,
    person: params.person,
    sizesUnconfirmed: params.sizesUnconfirmed,
  });
  return {
    ...params.brief,
    must_haves,
    color_direction,
    brand_direction,
    knowledge_state,
    department_scope: params.brief.department_scope ?? knowledge_state.department,
  };
}

async function enrichDeclinedFromAskCounts(params: {
  conversationId: string;
  personId: string;
  questions: { gap: DeclinedGapKey["gap"]; garment_type?: string }[];
  declined: DeclinedGapKey[];
}): Promise<DeclinedGapKey[]> {
  const next = [...params.declined];
  for (const q of params.questions) {
    const entry: DeclinedGapKey = {
      gap: q.gap,
      person_id: params.personId,
      garment_type: q.garment_type,
    };
    if (isGapDeclined(next, entry)) continue;
    const asks = await countGapAsksSinceReset({
      conversationId: params.conversationId,
      gap: q.gap,
      personId: params.personId,
      garmentType: q.garment_type,
    });
    if (asks >= 2) next.push(entry);
  }
  return next;
}

function explainBlockingGaps(params: {
  facts: FashionFactRow[];
  brief: FashionSearchBrief;
  profileHints: IntakeProfileHints | null;
  person?: Pick<PersonRow, "relation"> | null;
  declined: DeclinedGapKey[];
  personId: string;
}): {
  needs_clarification: boolean;
  missing_department: boolean;
  missing_size_buckets: string[];
} {
  const garments = garmentsForIntakeGate(params.brief);
  const deptDeclined = isGapDeclined(params.declined, {
    gap: "department",
    person_id: params.personId,
  });
  const missingDepartment =
    !deptDeclined &&
    !params.brief.department_scope &&
    getGenderPresentation(params.facts) == null &&
    !params.profileHints?.genderPresentation &&
    !departmentFromRelation(params.person?.relation);

  const department =
    params.brief.department_scope ??
    getGenderPresentation(params.facts) ??
    params.profileHints?.genderPresentation ??
    departmentFromRelation(params.person?.relation);

  const missingBuckets = missingSizeBucketsForGarments(
    params.facts,
    garments,
    params.profileHints,
    department,
  ).filter(
    (bucket) =>
      !isGapDeclined(params.declined, {
        gap: "size",
        person_id: params.personId,
        garment_type: bucket,
      }),
  );

  return {
    needs_clarification: missingDepartment || missingBuckets.length > 0,
    missing_department: missingDepartment,
    missing_size_buckets: missingBuckets,
  };
}

function logResolvedRouterTurn(
  params: {
    traceId?: string | null;
    conversationId: string;
    llmMove?: FashionRouterMove;
  },
  outcome: ResolvedFashionRouterOutcome,
): ResolvedFashionRouterOutcome {
  const result = outcome.routerResult;
  logAiChat("info", "fashion_resolve_router_turn", {
    traceId: params.traceId,
    conversationId: params.conversationId,
    llm_move: params.llmMove,
    final_move: result.move,
    recipient_person_id: outcome.recipientPersonId,
    sizes_unconfirmed: outcome.sizesUnconfirmed,
    clear_pending_brief: outcome.clearPendingBrief,
    has_pending_brief: Boolean(outcome.pendingBrief),
    declined_gaps: outcome.declinedGaps,
    result,
  });
  return outcome;
}

export async function resolveFashionRouterTurn(params: {
  conversationId: string;
  userId: string;
  routerContext: FashionRouterContext;
  guestSnapshot?: GuestFashionMemorySnapshot;
  signal?: AbortSignal;
  deps?: RunFashionRouterDeps;
  traceId?: string | null;
  lastUserMessage?: string;
}): Promise<ResolvedFashionRouterOutcome> {
  let llmMove: FashionRouterMove | undefined;
  const outcome = await resolveFashionRouterTurnInner(params, (move) => {
    llmMove = move;
  });
  return logResolvedRouterTurn(
    {
      traceId: params.traceId,
      conversationId: params.conversationId,
      llmMove,
    },
    outcome,
  );
}

async function resolveFashionRouterTurnInner(
  params: {
    conversationId: string;
    userId: string;
    routerContext: FashionRouterContext;
    guestSnapshot?: GuestFashionMemorySnapshot;
    signal?: AbortSignal;
    deps?: RunFashionRouterDeps;
    traceId?: string | null;
    lastUserMessage?: string;
  },
  onLlmMove: (move: FashionRouterMove) => void,
): Promise<ResolvedFashionRouterOutcome> {
  const pendingBrief = await loadPendingBrief(params.conversationId);
  const declinedGaps = await loadDeclinedGaps(params.conversationId);

  const lastUser =
    params.lastUserMessage?.trim() ||
    [...params.routerContext.conversationMessages]
      .reverse()
      .find((m) => m.role === "user")
      ?.content?.trim() ||
    "";

  if (lastUser) {
    await applyClarificationReplyFromMessage({
      userId: params.userId,
      conversationId: params.conversationId,
      userMessage: lastUser,
      guestSnapshot: params.guestSnapshot,
    });
  }

  if (isSupabaseAuthUserId(params.userId)) {
    await ensureSelfPerson(params.userId);
  }

  const profileHints = isSupabaseAuthUserId(params.userId)
    ? await loadIntakeProfileHints(params.userId)
    : null;

  const { people, factsByPersonId, signalsByPersonId } = await loadPeopleAndFacts({
    userId: params.userId,
    guestSnapshot: params.guestSnapshot,
  });

  let routerResult = await runFashionRouter(
    { context: params.routerContext, signal: params.signal, traceId: params.traceId },
    params.deps,
  );
  onLlmMove(routerResult.move);

  // Pending brief resume: only skip non-blocking clarifications. Blocking
  // department/size questions still win over a stale pending brief.
  if (
    pendingBrief &&
    routerResult.move === "ask_clarification" &&
    !routerResult.questions.some((q) =>
      q.gap === "department" || q.gap === "size" || q.gap === "person_name",
    )
  ) {
    routerResult = { move: "ready_to_search", brief: pendingBrief.brief };
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "brief_resumed",
      payload: { brief: pendingBrief.brief, saved_at: pendingBrief.savedAt },
    });
  }

  // Fast lane: register conversation-stated essentials before any gate decision.
  let peopleNow = people;
  let factsByPersonIdNow = factsByPersonId;
  let signalsByPersonIdNow = signalsByPersonId;
  const stated = statedFactsFromRouterResult(routerResult);
  let statedPersonId: string | null = null;

  if (stated) {
    const applied = await applyStatedFacts({
      userId: params.userId,
      stated,
      evidenceQuote: lastUser,
      guestSnapshot: params.guestSnapshot,
      people: peopleNow,
      personShortIds: params.routerContext.personShortIds,
      traceId: params.traceId,
    });
    statedPersonId = applied.personId;
    const reloaded = await loadPeopleAndFacts({
      userId: params.userId,
      guestSnapshot: params.guestSnapshot,
    });
    peopleNow = reloaded.people;
    factsByPersonIdNow = reloaded.factsByPersonId;
    signalsByPersonIdNow = reloaded.signalsByPersonId;
  }

  if (routerResult.move !== "ready_to_search") {
    if (routerResult.move === "ask_clarification") {
      const targetId =
        statedPersonId ??
        routerResult.target_person_id ??
        peopleNow.find((p) => p.relation === "self")?.id ??
        null;
      const facts = targetId
        ? (factsByPersonIdNow.get(targetId) ?? [])
        : [];
      const deptBrief = {
        department_scope: stated?.department,
      } as Pick<FashionSearchBrief, "department_scope">;
      let questions = sanitizeClarificationQuestions({
        questions: ensureQuestionsHaveQuickOptions(routerResult.questions),
        traceId: params.traceId,
      });
      questions = filterQuestionsSatisfiedByFacts({
        questions,
        facts,
        brief: deptBrief,
        profileHints: intakeHintsForRecipient(
          peopleNow.find((p) => p.id === targetId),
          profileHints,
        ),
      });

      if (!questions.length && pendingBrief) {
        routerResult = { move: "ready_to_search", brief: pendingBrief.brief };
      } else if (!questions.length) {
        // Questions satisfied by in-conversation facts — keep shopping intent.
        try {
          const { buildFallbackBriefFromContext } = await import(
            "../observability/fallback-brief"
          );
          const fallback = buildFallbackBriefFromContext({
            context: params.routerContext,
            reason: "clarification_questions_satisfied",
            pendingBrief,
          });
          if (fallback.brief.garments.length > 0) {
            routerResult = {
              move: "ready_to_search",
              brief: fallback.brief,
            };
          } else {
            return {
              routerResult: {
                move: "ask_clarification",
                reply:
                  (routerResult.move === "ask_clarification"
                    ? routerResult.reply
                    : undefined) || "What are you shopping for?",
                questions: [
                  {
                    text: "What are you looking for?",
                    gap: "garment",
                    quick_options: [
                      "One piece",
                      "Full outfit",
                      "A few options to rotate",
                      "Other",
                    ],
                  },
                ],
              },
              pendingBrief,
              clearPendingBrief: false,
              recipientPersonId: targetId,
              recipientFacts: facts,
              sizesUnconfirmed: [],
              declinedGaps,
            };
          }
        } catch {
          return {
            routerResult: {
              move: "ask_clarification",
              reply:
                (routerResult.move === "ask_clarification"
                  ? routerResult.reply
                  : undefined) || "What are you shopping for?",
              questions: [
                {
                  text: "What are you looking for?",
                  gap: "garment",
                  quick_options: [
                    "One piece",
                    "Full outfit",
                    "A few options to rotate",
                    "Other",
                  ],
                },
              ],
            },
            pendingBrief,
            clearPendingBrief: false,
            recipientPersonId: targetId,
            recipientFacts: facts,
            sizesUnconfirmed: [],
            declinedGaps,
          };
        }
      } else {
        return {
          routerResult: withClarificationDefaults(
            {
              ...routerResult,
              questions,
              target_person_id: targetId ?? routerResult.target_person_id,
              stated_facts: stated,
            },
            params.traceId,
          ),
          pendingBrief,
          clearPendingBrief: false,
          recipientPersonId: targetId,
          recipientFacts: facts,
          sizesUnconfirmed: [],
          declinedGaps,
        };
      }
    } else {
      return {
        routerResult,
        pendingBrief,
        clearPendingBrief: false,
        recipientPersonId: null,
        recipientFacts: [],
        sizesUnconfirmed: [],
        declinedGaps,
      };
    }
  }

  // ready_to_search (possibly upgraded from empty clarification)
  if (routerResult.move !== "ready_to_search") {
    return {
      routerResult,
      pendingBrief,
      clearPendingBrief: false,
      recipientPersonId: null,
      recipientFacts: [],
      sizesUnconfirmed: [],
      declinedGaps,
    };
  }

  let brief = applyDepartmentFromUserMessage(routerResult.brief, lastUser);
  brief = mergeDepartmentFromStatedFacts(brief, stated ?? brief.stated_facts);
  brief = mergeBudgetFromStatedFacts(brief, stated ?? brief.stated_facts);
  if (statedPersonId) {
    brief = { ...brief, recipient_person_id: statedPersonId };
  }

  const recipientId =
    statedPersonId ??
    resolveBriefRecipientPersonId({
      brief,
      personShortIds: params.routerContext.personShortIds,
      people: peopleNow,
      userMessage: lastUser,
    }) ??
    pendingBrief?.recipientPersonId ??
    peopleNow.find((p) => p.relation === "self")?.id ??
    null;

  if (!recipientId) {
    logAiChat("warn", "fashion_intake_gate_no_recipient", {
      traceId: params.traceId,
      people_count: peopleNow.length,
      brief_recipient: brief.recipient_person_id,
      short_ids: Object.keys(params.routerContext.personShortIds),
    });
    return {
      routerResult: { move: "ready_to_search", brief },
      pendingBrief,
      clearPendingBrief: false,
      recipientPersonId: null,
      recipientFacts: [],
      sizesUnconfirmed: [],
      declinedGaps,
    };
  }

  const person =
    peopleNow.find((p) => p.id === recipientId) ??
    (await (async () => {
      if (!isSupabaseAuthUserId(params.userId)) return undefined;
      return ensureSelfPerson(params.userId);
    })());
  const facts = factsByPersonIdNow.get(recipientId) ?? [];
  const recipientHints = intakeHintsForRecipient(person, profileHints);
  brief = applyDepartmentFromRelation(brief, person);

  // Promote twice-asked unanswered gaps to declined before evaluating the gate.
  const provisionalBlocking = buildBlockingClarification({
    brief,
    facts,
    targetPersonId: recipientId,
    personLabel: personLabel(person),
    person,
    profileHints: recipientHints,
  });
  let activeDeclined = await enrichDeclinedFromAskCounts({
    conversationId: params.conversationId,
    personId: recipientId,
    questions: provisionalBlocking.questions.map((q) => ({
      gap: q.gap,
      garment_type: q.garment_type,
    })),
    declined: declinedGaps,
  });

  const gapExplain = explainBlockingGaps({
    facts,
    brief,
    profileHints: recipientHints,
    person,
    declined: activeDeclined,
    personId: recipientId,
  });

  logAiChat("info", "fashion_blocking_gate", {
    traceId: params.traceId,
    recipient_id: recipientId,
    recipient_relation: person?.relation ?? null,
    ...gapExplain,
    declined_gaps: activeDeclined,
  });

  if (gapExplain.needs_clarification) {
    const gateNote = [
      `BLOCKING GAPS REMAIN for ${personLabel(person)}:`,
      gapExplain.missing_department ? "- department" : null,
      ...gapExplain.missing_size_buckets.map((b) => `- size (${b})`),
      "Use ask_clarification.",
    ]
      .filter(Boolean)
      .join("\n");

    const basePrompt = buildFashionRouterPrompt(params.routerContext);
    const retried = await runFashionRouter(
      {
        context: {
          ...params.routerContext,
          conversationMessages: [
            ...params.routerContext.conversationMessages,
            { role: "assistant", content: `[SYSTEM] ${gateNote}` },
          ],
        },
        signal: params.signal,
        systemOverride: `${basePrompt}\n\n${gateNote}`,
        traceId: params.traceId,
        stage: "gate_retry",
      },
      params.deps,
    );

    if (retried.move === "ask_clarification") {
      const filtered = filterQuestionsSatisfiedByFacts({
        questions: filterQuestionsByDeclined(
          sanitizeClarificationQuestions({
            questions: retried.questions,
            traceId: params.traceId,
          }),
          recipientId,
          activeDeclined,
        ),
        facts,
        brief,
        profileHints: recipientHints,
      });
      if (filtered.length) {
        recordPipelineEvent({
          traceId: params.traceId,
          stage: "gate",
          payload: {
            decision: "ask_clarification_after_retry",
            missing_fields: filtered.map((q) => q.gap),
            ...gapExplain,
          },
        });
        return {
          routerResult: withClarificationDefaults(
            {
              ...retried,
              questions: filtered,
              target_person_id: recipientId,
            },
            params.traceId,
          ),
          pendingBrief: pendingBrief ?? pendingBriefMeta(brief, recipientId),
          clearPendingBrief: false,
          recipientPersonId: recipientId,
          recipientFacts: facts,
          sizesUnconfirmed: [],
          declinedGaps: activeDeclined,
        };
      }
    }

    // Deterministic templates — gate guarantee.
    const filtered = filterQuestionsSatisfiedByFacts({
      questions: filterQuestionsByDeclined(
        provisionalBlocking.questions,
        recipientId,
        activeDeclined,
      ),
      facts,
      brief,
      profileHints: recipientHints,
    });

    if (filtered.length) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: {
          decision: "deterministic_clarification",
          missing_fields: filtered.map((q) => q.gap),
          ...gapExplain,
        },
      });
      return {
        routerResult: withClarificationDefaults(
          {
            move: "ask_clarification",
            reply: provisionalBlocking.reply,
            questions: filtered,
            target_person_id: recipientId,
          },
          params.traceId,
        ),
        pendingBrief: pendingBrief ?? pendingBriefMeta(brief, recipientId),
        clearPendingBrief: false,
        recipientPersonId: recipientId,
        recipientFacts: facts,
        sizesUnconfirmed: [],
        declinedGaps: activeDeclined,
      };
    }
    // All remaining gaps declined or satisfied — fall through to search.
  }

  if (
    person &&
    needsDepartmentClarification({
      brief,
      facts,
      person,
      profileHints: recipientHints,
    }) &&
    !isGapDeclined(activeDeclined, { gap: "department", person_id: recipientId })
  ) {
    const deptOnly = provisionalBlocking.questions.filter(
      (q) => q.gap === "department",
    );
    if (deptOnly.length) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: { decision: "department_clarification", missing_fields: ["department"] },
      });
      return {
        routerResult: withClarificationDefaults(
          {
            move: "ask_clarification",
            reply: provisionalBlocking.reply,
            questions: deptOnly,
            target_person_id: recipientId,
          },
          params.traceId,
        ),
        pendingBrief: pendingBrief ?? pendingBriefMeta(brief, recipientId),
        clearPendingBrief: false,
        recipientPersonId: recipientId,
        recipientFacts: facts,
        sizesUnconfirmed: [],
        declinedGaps: activeDeclined,
      };
    }
  }

  if (pendingBrief && !brief.department_scope && pendingBrief.brief.department_scope) {
    brief = { ...brief, department_scope: pendingBrief.brief.department_scope };
  }

  const unconfirmedBuckets = person
    ? computeSizesUnconfirmed({
        person,
        facts,
        brief,
        profileHints: recipientHints,
      })
    : [];
  const sizesUnconfirmed = garmentTypesForUnconfirmedBuckets(
    unconfirmedBuckets as ReturnType<typeof missingSizeBucketsForGarments>,
    brief.garments.length ? brief.garments : garmentsForIntakeGate(brief),
  );

  brief = finalizeBriefForSearch({
    brief,
    person: person!,
    facts,
    signals: signalsByPersonIdNow.get(recipientId) ?? [],
    sizesUnconfirmed,
    lastUserMessage: lastUser,
  });

  if (recipientHints?.genderPresentation && !brief.department_scope) {
    brief = { ...brief, department_scope: recipientHints.genderPresentation };
  }

  brief = applyDepartmentFromRelation(brief, person);
  if (
    brief.department_scope &&
    brief.knowledge_state &&
    brief.knowledge_state.department !== brief.department_scope
  ) {
    brief = {
      ...brief,
      knowledge_state: {
        ...brief.knowledge_state,
        department: brief.department_scope,
      },
    };
  }

  recordPipelineEvent({
    traceId: params.traceId,
    stage: "brief_persisted",
    payload: {
      brief,
      recipient_person_id: recipientId,
      knowledge_state: brief.knowledge_state,
    },
  });

  return {
    routerResult: { move: "ready_to_search", brief },
    pendingBrief: pendingBrief ?? null,
    clearPendingBrief: true,
    recipientPersonId: recipientId,
    recipientFacts: facts,
    sizesUnconfirmed,
    declinedGaps: activeDeclined,
  };
}

export { pendingBriefMeta, loadPendingBrief };

/** @deprecated intake_completed_at is no longer written. */
export async function persistIntakeCompleted(_params: {
  userId: string;
  personId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<void> {
  // no-op — once-ever property is enforced by facts-in-PROFILES
}
