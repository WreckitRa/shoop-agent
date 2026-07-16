import { logAiChat } from "@/lib/ai-chat/observability";
import { isSupabaseAuthUserId } from "../auth";
import { listActiveFashionFacts } from "../facts";
import { ensureSelfPerson } from "../people";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { applyClarificationReplyFromMessage } from "./apply-intake-reply";
import { applyStatedFacts } from "./apply-stated-facts";
import {
  answeredGapsFromFacts,
  answeredGapsFromStatedFacts,
  checkReaskAfterAnswer,
  filterQuestionsSatisfiedByConversation,
  isGapAnswered,
  mergeAnsweredLedgers,
  suppressDeclinedForAnsweredGaps,
  type AnsweredGapEntry,
} from "./clarification-dedup";
import { sanitizeClarificationQuestions } from "./clarification-sanitize";
import {
  mergeResolvedGarmentsIntoBriefGarments,
} from "./garment-answer";
import { applyInferredBudgetScope } from "../budget/budget-scope";
import { buildKnowledgeState } from "./knowledge-state";
import {
  ambiguousNameMatches,
  formatPersonChoiceLabel,
  isNameOptionalForRelation,
  rosterDisplayNames,
  singleRelationMatch,
} from "../extraction/person-identity";
import { extractMentionedRelations } from "../people-from-mentions";
import {
  buildBlockingClarification,
  computeSizesUnconfirmed,
  garmentTypesForUnconfirmedBuckets,
  garmentsForIntakeGate,
  getGenderPresentation,
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
  opts?: {
    rosterNames?: string[];
    stripPersonNameQuestions?: boolean;
  },
): FashionRouterResult {
  // Sanitize first so roster-name chips are logged/stripped, then default Skip.
  return {
    ...result,
    questions: ensureQuestionsHaveQuickOptions(
      sanitizeClarificationQuestions({
        questions: result.questions,
        traceId,
        rosterNames: opts?.rosterNames,
        stripPersonNameQuestions: opts?.stripPersonNameQuestions,
      }),
    ),
  };
}

function buildAmbiguousNameClarification(params: {
  people: import("../types").PersonRow[];
  reply?: string;
}): Extract<FashionRouterResult, { move: "ask_clarification" }> {
  const options = params.people.map((p) => formatPersonChoiceLabel(p));
  const sharedName = params.people[0]?.name?.trim() || "person";
  return {
    move: "ask_clarification",
    reply:
      params.reply ??
      `Which ${sharedName} did you mean — I have more than one on your roster.`,
    questions: [
      {
        text: "Which person should I shop for?",
        gap: "recipient",
        quick_options: [...options, "Other"],
      },
    ],
  };
}

function clarificationSanitizeOpts(params: {
  people: PersonRow[];
  lastUser?: string;
  stated?: FashionStatedFacts | null;
}): {
  rosterNames: string[];
  stripPersonNameQuestions: boolean;
} {
  const rosterNames = rosterDisplayNames(params.people);
  const mentioned = params.lastUser
    ? extractMentionedRelations(params.lastUser)
    : [];
  const relationRaw =
    params.stated?.new_person?.relation?.trim() || mentioned[0] || "";
  const stripPersonNameQuestions = relationRaw
    ? isNameOptionalForRelation(params.people, relationRaw)
    : false;
  return { rosterNames, stripPersonNameQuestions };
}

function filterQuestionsSatisfiedByFacts(params: {
  questions: FashionClarificationQuestion[];
  facts: FashionFactRow[];
  brief: Pick<
    FashionSearchBrief,
    "department_scope" | "garments" | "stated_facts"
  > & { stated_facts?: FashionStatedFacts };
  profileHints?: IntakeProfileHints | null;
  /** Garments just answered on the prior clarification turn. */
  resolvedGarments?: string[];
  answeredLedger?: AnsweredGapEntry[];
  stated?: FashionStatedFacts | null;
  traceId?: string | null;
  personId?: string | null;
}): FashionClarificationQuestion[] {
  const stated = params.stated ?? params.brief.stated_facts;
  // Tripwire first: proposed reasks of known facts self-announce.
  checkReaskAfterAnswer({
    questions: params.questions,
    stated,
    answeredLedger: params.answeredLedger,
    facts: params.facts,
    profileHints: params.profileHints,
    personId: params.personId,
    traceId: params.traceId,
  });
  const filtered = filterQuestionsSatisfiedByConversation({
    questions: params.questions,
    facts: params.facts,
    brief: {
      department_scope: params.brief.department_scope,
      garments: params.brief.garments,
      stated_facts: stated ?? undefined,
    },
    profileHints: params.profileHints,
    resolvedGarments: params.resolvedGarments,
    answeredLedger: params.answeredLedger,
    traceId: params.traceId,
  });
  // Defense-in-depth: after builders consume stated_facts this should be a
  // no-op. Logging here means a builder still proposed a known gap.
  if (
    filtered.length < params.questions.length &&
    (process.env.NODE_ENV === "development" ||
      process.env.FASHION_GATE_FILTER_ASSERT === "1")
  ) {
    const dropped = params.questions
      .filter((q) => !filtered.some((f) => f.gap === q.gap && f.text === q.text))
      .map((q) => ({ gap: q.gap, garment_type: q.garment_type }));
    logAiChat("warn", "fashion_gate_filter_activated", {
      traceId: params.traceId,
      dropped,
      before: params.questions.length,
      after: filtered.length,
    });
  }
  return filtered;
}

/**
 * WHO gap: when exactly one roster person matches the stated relation,
 * auto-resolve and strip confirmation questions.
 */
function autoresolveSingleRelationMatch(params: {
  questions: FashionClarificationQuestion[];
  people: PersonRow[];
  lastUser: string;
  traceId?: string | null;
}): {
  questions: FashionClarificationQuestion[];
  resolvedPerson: PersonRow | null;
} {
  const match = singleRelationMatch({
    userText: params.lastUser,
    people: params.people,
  });
  if (!match) {
    return { questions: params.questions, resolvedPerson: null };
  }

  const kept = params.questions.filter((q) => {
    if (q.gap !== "recipient" && q.gap !== "person_name") return true;
    // "which mother" / "confirm which" style confirmation when only one match.
    const confirmish =
      /which|confirm|did you mean|who (is|should)/i.test(q.text) ||
      q.gap === "recipient";
    if (!confirmish) return true;
    logAiChat("info", "single_match_autoresolved", {
      traceId: params.traceId,
      person_id: match.id,
      relation: match.relation,
      name: match.name,
      stripped_gap: q.gap,
      stripped_text: q.text.slice(0, 120),
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "gate",
      payload: {
        decision: "single_match_autoresolved",
        person_id: match.id,
        relation: match.relation,
        stripped_gap: q.gap,
      },
    });
    return false;
  });

  return { questions: kept, resolvedPerson: match };
}

function answeredLedgerFromClarificationApply(params: {
  clarificationApply: {
    facts: FashionFactRow[];
    resolvedGarments?: string[];
  } | null;
  stated?: FashionStatedFacts | null;
  facts: FashionFactRow[];
  profileHints?: IntakeProfileHints | null;
}): AnsweredGapEntry[] {
  const fromApply: AnsweredGapEntry[] = [];
  for (const f of params.clarificationApply?.facts ?? []) {
    if (f.fact_type === "gender_presentation") {
      fromApply.push({ gap: "department", source: "clarification_apply" });
    } else if (f.fact_type === "size" && f.garment_type) {
      fromApply.push({
        gap: "size",
        garment_type: f.garment_type,
        source: "clarification_apply",
      });
    } else if (f.fact_type === "budget_band") {
      fromApply.push({ gap: "budget", source: "clarification_apply" });
    }
  }
  if (params.clarificationApply?.resolvedGarments?.length) {
    fromApply.push({ gap: "garment", source: "clarification_apply" });
  }
  return mergeAnsweredLedgers(
    answeredGapsFromFacts(params.facts, params.profileHints),
    answeredGapsFromStatedFacts(params.stated),
    fromApply,
  );
}

function applyResolvedGarmentsToBrief(
  brief: FashionSearchBrief,
  resolvedGarments?: string[],
): FashionSearchBrief {
  if (!resolvedGarments?.length) return brief;
  return {
    ...brief,
    garments: mergeResolvedGarmentsIntoBriefGarments(
      brief.garments,
      resolvedGarments,
    ),
  };
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
  profileHints?: IntakeProfileHints | null;
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
    profileHints: params.profileHints,
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
  /** Conversation-derived answers the gate must consume. */
  answeredLedger?: AnsweredGapEntry[];
  stated?: FashionStatedFacts | null;
}): {
  needs_clarification: boolean;
  missing_department: boolean;
  missing_size_buckets: string[];
} {
  const ledger = mergeAnsweredLedgers(
    answeredGapsFromFacts(params.facts, params.profileHints),
    answeredGapsFromStatedFacts(params.stated ?? params.brief.stated_facts),
    params.answeredLedger ?? [],
  );

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
    !departmentFromRelation(params.person?.relation) &&
    !isGapAnswered(ledger, "department");

  const department =
    params.brief.department_scope ??
    getGenderPresentation(params.facts) ??
    params.profileHints?.genderPresentation ??
    departmentFromRelation(params.person?.relation) ??
    (params.stated ?? params.brief.stated_facts)?.department;

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
      }) && !isGapAnswered(ledger, "size", bucket),
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

  let clarificationApply: Awaited<
    ReturnType<typeof applyClarificationReplyFromMessage>
  > | null = null;
  if (lastUser) {
    clarificationApply = await applyClarificationReplyFromMessage({
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

  const resolvedGarments = clarificationApply?.resolvedGarments ?? [];

  if (routerResult.move !== "ready_to_search") {
    if (routerResult.move === "ask_clarification") {
      // Single roster match for stated relation → resolve silently.
      const single = autoresolveSingleRelationMatch({
        questions: routerResult.questions,
        people: peopleNow,
        lastUser,
        traceId: params.traceId,
      });
      let targetId =
        statedPersonId ??
        single.resolvedPerson?.id ??
        routerResult.target_person_id ??
        clarificationApply?.personId ??
        peopleNow.find((p) => p.relation === "self")?.id ??
        null;
      if (single.resolvedPerson && !statedPersonId) {
        statedPersonId = single.resolvedPerson.id;
        targetId = single.resolvedPerson.id;
      }
      const facts = targetId
        ? (factsByPersonIdNow.get(targetId) ?? [])
        : [];
      const recipientHintsAsk = intakeHintsForRecipient(
        peopleNow.find((p) => p.id === targetId),
        profileHints,
      );
      const answeredLedger = answeredLedgerFromClarificationApply({
        clarificationApply,
        stated,
        facts,
        profileHints: recipientHintsAsk,
      });
      const garmentBrief = {
        department_scope: stated?.department ?? pendingBrief?.brief.department_scope,
        garments: mergeResolvedGarmentsIntoBriefGarments(
          pendingBrief?.brief.garments ?? [],
          resolvedGarments,
        ),
        stated_facts: stated,
      } as Pick<
        FashionSearchBrief,
        "department_scope" | "garments" | "stated_facts"
      >;
      const sanitizeOpts = clarificationSanitizeOpts({
        people: peopleNow,
        lastUser,
        stated,
      });
      let questions = ensureQuestionsHaveQuickOptions(
        sanitizeClarificationQuestions({
          questions: single.questions,
          traceId: params.traceId,
          ...sanitizeOpts,
        }),
      );
      questions = filterQuestionsSatisfiedByFacts({
        questions,
        facts,
        brief: garmentBrief,
        resolvedGarments,
        profileHints: recipientHintsAsk,
        answeredLedger,
        stated,
        personId: targetId,
        traceId: params.traceId,
      });

      const pendingWithGarments =
        resolvedGarments.length && targetId
          ? pendingBriefMeta(
              applyResolvedGarmentsToBrief(
                pendingBrief?.brief ??
                  ({
                    recipient_person_id: targetId,
                    request_type: "multi_item",
                    garments: resolvedGarments,
                    occasion_context: "general",
                    quantity_hint: "a few",
                    must_haves: [],
                    nice_to_haves: [],
                    budget_context: { stated: false },
                    style_direction: lastUser.slice(0, 200) || "accessories",
                  } satisfies FashionSearchBrief),
                resolvedGarments,
              ),
              targetId,
            )
          : pendingBrief
            ? resolvedGarments.length
              ? pendingBriefMeta(
                  applyResolvedGarmentsToBrief(pendingBrief.brief, resolvedGarments),
                  pendingBrief.recipientPersonId,
                )
              : pendingBrief
            : null;

      if (!questions.length && pendingWithGarments) {
        routerResult = {
          move: "ready_to_search",
          brief: {
            ...pendingWithGarments.brief,
            stated_facts: stated ?? pendingWithGarments.brief.stated_facts,
          },
        };
      } else if (!questions.length) {
        // Questions satisfied by in-conversation facts — keep shopping intent.
        try {
          const { buildFallbackBriefFromContext } = await import(
            "../observability/fallback-brief"
          );
          const fallback = buildFallbackBriefFromContext({
            context: params.routerContext,
            reason: "clarification_questions_satisfied",
            pendingBrief: pendingWithGarments ?? pendingBrief,
          });
          const brief = {
            ...applyResolvedGarmentsToBrief(
              fallback.brief,
              resolvedGarments,
            ),
            stated_facts: stated ?? fallback.brief.stated_facts,
          };
          if (brief.garments.length > 0) {
            routerResult = {
              move: "ready_to_search",
              brief,
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
            sanitizeOpts,
          ),
          pendingBrief: pendingWithGarments ?? pendingBrief,
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
        pendingBrief: resolvedGarments.length
          ? pendingBrief
            ? pendingBriefMeta(
                applyResolvedGarmentsToBrief(pendingBrief.brief, resolvedGarments),
                pendingBrief.recipientPersonId,
              )
            : pendingBrief
          : pendingBrief,
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

  // Name collision across incompatible relations → ask which person.
  const ambiguous = lastUser
    ? ambiguousNameMatches({ userText: lastUser, people: peopleNow })
    : null;
  if (ambiguous && ambiguous.length >= 2) {
    const clarification = buildAmbiguousNameClarification({
      people: ambiguous,
      reply: `I have more than one ${ambiguous[0]!.name?.trim() ?? "person"} — which one?`,
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "gate",
      payload: {
        decision: "ambiguous_roster_name",
        names: ambiguous.map((p) => formatPersonChoiceLabel(p)),
      },
    });
    return {
      routerResult: withClarificationDefaults(clarification, params.traceId, {
        rosterNames: rosterDisplayNames(peopleNow),
      }),
      pendingBrief,
      clearPendingBrief: false,
      recipientPersonId: null,
      recipientFacts: [],
      sizesUnconfirmed: [],
      declinedGaps,
    };
  }

  let brief = applyResolvedGarmentsToBrief(
    applyDepartmentFromUserMessage(routerResult.brief, lastUser),
    resolvedGarments,
  );
  brief = applyInferredBudgetScope(brief, lastUser);
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
  // Ensure conversation-derived facts stay on the brief for template/ledger.
  if ((stated ?? brief.stated_facts) && !brief.stated_facts) {
    brief = { ...brief, stated_facts: stated ?? brief.stated_facts };
  }

  const answeredLedger = answeredLedgerFromClarificationApply({
    clarificationApply,
    stated: stated ?? brief.stated_facts,
    facts,
    profileHints: recipientHints,
  });

  // Promote twice-asked unanswered gaps to declined before evaluating the gate.
  // Gaps answered via stated_facts / clarification apply do not count as dodges.
  const provisionalBlocking = buildBlockingClarification({
    brief,
    facts,
    targetPersonId: recipientId,
    personLabel: personLabel(person),
    person,
    profileHints: recipientHints,
    stated: stated ?? brief.stated_facts,
  });
  const dodgeCandidateQuestions = suppressDeclinedForAnsweredGaps(
    provisionalBlocking.questions.map((q) => ({
      gap: q.gap,
      garment_type: q.garment_type,
    })),
    answeredLedger,
  );
  let activeDeclined = await enrichDeclinedFromAskCounts({
    conversationId: params.conversationId,
    personId: recipientId,
    questions: dodgeCandidateQuestions,
    declined: declinedGaps,
  });

  if (
    clarificationApply?.declineBudgetRaise &&
    !isGapDeclined(activeDeclined, { gap: "budget", person_id: recipientId })
  ) {
    activeDeclined = [
      ...activeDeclined,
      { gap: "budget", person_id: recipientId },
    ];
  }

  const gapExplain = explainBlockingGaps({
    facts,
    brief,
    profileHints: recipientHints,
    person,
    declined: activeDeclined,
    personId: recipientId,
    answeredLedger,
    stated: stated ?? brief.stated_facts,
  });

  logAiChat("info", "fashion_blocking_gate", {
    traceId: params.traceId,
    recipient_id: recipientId,
    recipient_relation: person?.relation ?? null,
    ...gapExplain,
    declined_gaps: activeDeclined,
    answered_ledger: answeredLedger,
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
    // Opus rejects assistant-prefill: conversation must end with a user turn.
    // Keep the note in systemOverride and mirror it as a trailing user message.
    const retried = await runFashionRouter(
      {
        context: {
          ...params.routerContext,
          conversationMessages: [
            ...params.routerContext.conversationMessages,
            { role: "user", content: `[SYSTEM] ${gateNote}` },
          ],
        },
        signal: params.signal,
        systemOverride: `${basePrompt}\n\n${gateNote}`,
        traceId: params.traceId,
        stage: "gate_retry",
      },
      params.deps,
    );

    const gateSanitizeOpts = clarificationSanitizeOpts({
      people: peopleNow,
      lastUser,
      stated: stated ?? brief.stated_facts,
    });

    if (retried.move === "ask_clarification") {
      const singleRetry = autoresolveSingleRelationMatch({
        questions: retried.questions,
        people: peopleNow,
        lastUser,
        traceId: params.traceId,
      });
      const filtered = filterQuestionsSatisfiedByFacts({
        questions: filterQuestionsByDeclined(
          sanitizeClarificationQuestions({
            questions: singleRetry.questions,
            traceId: params.traceId,
            ...gateSanitizeOpts,
          }),
          recipientId,
          activeDeclined,
        ),
        facts,
        brief,
        resolvedGarments,
        profileHints: recipientHints,
        answeredLedger,
        stated: stated ?? brief.stated_facts,
        personId: recipientId,
        traceId: params.traceId,
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
              stated_facts: stated ?? brief.stated_facts,
            },
            params.traceId,
            gateSanitizeOpts,
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

    // Deterministic templates — gate guarantee. Dedup against conversation
    // facts / ledger BEFORE emitting; zero remaining → search.
    const filtered = filterQuestionsSatisfiedByFacts({
      questions: filterQuestionsByDeclined(
        provisionalBlocking.questions,
        recipientId,
        activeDeclined,
      ),
      facts,
      brief,
      resolvedGarments,
      profileHints: recipientHints,
      answeredLedger,
      stated: stated ?? brief.stated_facts,
      personId: recipientId,
      traceId: params.traceId,
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
            stated_facts: stated ?? brief.stated_facts,
          },
          params.traceId,
          gateSanitizeOpts,
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
          clarificationSanitizeOpts({
            people: peopleNow,
            lastUser,
            stated: stated ?? brief.stated_facts,
          }),
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
    profileHints: recipientHints,
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

  if (clarificationApply?.raisedBudgetMax != null) {
    brief = {
      ...brief,
      budget_context: {
        stated: true,
        max: clarificationApply.raisedBudgetMax,
        currency: brief.budget_context.currency ?? "USD",
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
