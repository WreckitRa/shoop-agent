import { logAiChat } from "@/lib/ai-chat/observability";
import { prisma } from "@/lib/ai-chat/db";
import { isSupabaseAuthUserId } from "../auth";
import { listActiveFashionFacts } from "../facts";
import { ensureSelfPerson } from "../people";
import type { GuestFashionMemorySnapshot } from "../local/store";
import {
  chipsFromClarificationTurn,
  findConsistencyMismatches,
  hardSetBriefFromChips,
  noteBriefHardset,
  type ConsistencyGap,
} from "./consistency-gate";
import { applyClarificationReplyFromMessage } from "./apply-intake-reply";
import { bundleUnresolvedRecipientAsk } from "../unresolved";
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
import { normalizeClarificationSizeFields } from "./normalize-size-questions";
import { sizeBucketsForGarments, sizeFamiliesAskedFromQuestions } from "./garment-size-fields";
import { mergeFashionFacts } from "./merge-facts";
import { applyDurableDepartmentScope } from "./durable-department";
import { sanitizeStatedSizes, clampStatedSizesToNamedFamilies } from "./usable-stated-size";
import {
  mergeResolvedGarmentsIntoBriefGarments,
  normalizeGarmentClarificationAnswer,
  hasConcreteGarmentDirection,
} from "./garment-answer";
import { refineSwimBriefGarments } from "../hard-drops/swimwear";
import { applyInferredBudgetScope } from "../budget/budget-scope";
import { buildKnowledgeState } from "./knowledge-state";
import {
  ambiguousNameMatches,
  formatPersonChoiceLabel,
  isNameOptionalForRelation,
  rosterDisplayNames,
  singleRelationMatch,
} from "../extraction/person-identity";
import {
  garmentFamiliesFromRequestEvents,
  mapHonestyToVoice,
  parseOnboardingMetaFromFacts,
} from "../router/profile-context-format";
import {
  noteClarificationEmitted,
  recordReadyToSearchOutcome,
} from "../observability/pre-search-metrics";
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
  resumePendingShoppingBrief,
} from "./pending-brief";
import type { FashionPendingBriefMetaV1 } from "../router/types";
import {
  resolveBriefRecipientPersonId,
  runFashionRouter,
  type RunFashionRouterDeps,
} from "../router/llm-router";
import {
  buildPullLine,
  formatKnownSummarySpeech,
  knownSummaryPassesTemplate,
} from "../router/voice-hygiene";
import {
  applyVoiceLineReuseGate,
} from "../router/voice-line-reuse";
import {
  ANCHOR_KEEP_ASSUMPTION,
  buildPreferenceAnchorQuestion,
  decideAnchorGate,
  parsePreferenceAnchorFromWords,
  pickHintFromProfile,
  profileHasRelevantAnchorSignal,
} from "../router/anchor-gate";
import { garmentSlotFamilyKey } from "../router/garment-family";
import {
  familyIdsMentionedInText,
  garmentFamilyId,
} from "../catalog-search/garment-taxonomy";
import {
  ensureQuestionsHaveQuickOptions,
  ensureRideAlongDefaults,
  optionLabels,
  personalizeClarificationOptions,
} from "../router/clarification-defaults";
import {
  buildSlotsGateQuestion,
  enrichSlotsChecklistQuestion,
} from "../router/slots-checklist";
import {
  ensureYouDecideOption,
  isConsultQuestion,
  isEscapeOrYouDecideMessage,
  JUST_SHOW_ME_LABEL,
  nextConsultRoundsUsed,
  questionsHaveConsult,
  coerceMislabelledPreferenceAnchor,
} from "../router/consultation";
import type {
  FashionClarificationQuestion,
  FashionRouterContext,
  FashionRouterMove,
  FashionRouterResult,
  FashionSearchBrief,
  FashionStatedFacts,
} from "../router/types";
import { loadLastOnScreenSearch } from "./last-catalog-search";
import { classifyRefinementMode, type RefinementMode } from "./refinement-mode";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionFactRow, PersonRow, StyleSignalRow } from "../types";
import { safeTrim } from "../safe-trim";
import { recordPipelineEvent } from "../observability/trace";
import { departmentFromRelation, coercePersonDepartment } from "../department";
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
    selfDisplayName?: string | null;
    signals?: Array<{
      signal_type: string;
      value: string;
      polarity: number;
      context?: string | null;
    }>;
    departmentLabel?: string;
    /** Injected when LLM omitted known_summary on a known client. */
    knownSummary?: string;
    /** Recent pick label — forces preference_anchor text to reference it. */
    pickHint?: string | null;
    /** Last user turn — for voice hygiene (banned lines / client words). */
    lastUser?: string;
  },
): FashionRouterResult {
  noteClarificationEmitted();
  const personalized = personalizeClarificationOptions({
    questions: result.questions,
    rideAlong: result.ride_along,
    signals: opts?.signals,
    departmentLabel: opts?.departmentLabel,
  });
  const known_summary =
    result.known_summary?.trim() || opts?.knownSummary?.trim() || undefined;
  // Never code-substitute reply text — banned/reuse is an LLM rewrite gate.
  const reply = result.reply?.trim() || "";
  // Sanitize first so roster-name chips are logged/stripped, then size fields,
  // then default Skip chips. Enrich slots checklists from the brief.
  const sized = normalizeClarificationSizeFields(
    sanitizeClarificationQuestions({
      questions: personalized.questions,
      traceId,
      rosterNames: opts?.rosterNames,
      stripPersonNameQuestions: opts?.stripPersonNameQuestions,
      selfDisplayName: opts?.selfDisplayName,
    }),
  );
  const withSlots = sized.map((q) =>
    q.gap === "slots"
      ? enrichSlotsChecklistQuestion(q, result.brief ?? null)
      : q,
  );
  const pickHint =
    opts?.pickHint?.trim() ||
    (opts?.signals?.length
      ? pickHintFromProfile({ signals: opts.signals })
      : null);
  const withAnchor = withSlots.map((q) => {
    if (q.gap !== "preference_anchor" || !pickHint) return q;
    const token = pickHint.toLowerCase().split(/\s+/).pop() ?? "";
    if (token.length >= 4 && q.text.toLowerCase().includes(token)) return q;
    return {
      ...buildPreferenceAnchorQuestion({ referent: pickHint }),
      quick_options: q.quick_options?.length
        ? q.quick_options
        : buildPreferenceAnchorQuestion({ referent: pickHint }).quick_options,
    };
  });
  // multi_item never gets an outfit slots checklist — garment ask owns it.
  const questions =
    result.brief?.request_type === "multi_item"
      ? withAnchor.filter((q) => q.gap !== "slots")
      : withAnchor;
  const relabelled = questions.map(coerceMislabelledPreferenceAnchor);
  return {
    ...result,
    ...(reply ? { reply } : {}),
    ...(known_summary ? { known_summary } : {}),
    questions: ensureQuestionsHaveQuickOptions(relabelled).map(
      ensureYouDecideOption,
    ),
    ride_along: ensureRideAlongDefaults(personalized.ride_along),
    ...(questionsHaveConsult(relabelled) && !result.escape_chip
      ? { escape_chip: JUST_SHOW_ME_LABEL }
      : {}),
  };
}

function goingOnKnownSummary(params: {
  department?: string | null;
  garments?: string[];
  sizeLines?: string[];
  pickHint?: string | null;
}): string | undefined {
  return formatKnownSummarySpeech(params);
}

/** Families the client named in any user turn this appointment (taxonomy provenance). */
function clientNamedGarmentFamilies(
  messages: Array<{ role: string; content: string }>,
): Set<string> {
  const named = new Set<string>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const id of familyIdsMentionedInText(m.content)) named.add(id);
    for (const g of normalizeGarmentClarificationAnswer(m.content)) {
      named.add(garmentFamilyId(g));
    }
  }
  return named;
}

/** Brief garments whose family the client never wrote. */
function briefGarmentsUnnamedByClient(params: {
  garments: string[];
  namedFamilies: Set<string>;
}): string[] {
  const out: string[] = [];
  for (const raw of params.garments) {
    const g = raw.trim();
    if (!g) continue;
    if (isEscapeOrYouDecideMessage(g, undefined)) continue;
    if (/^(you decide|other|add a piece|ooh nice|hmm|nice)$/i.test(g)) {
      continue;
    }
    const k = garmentFamilyId(g);
    if (!k || params.namedFamilies.has(k)) continue;
    out.push(g);
  }
  return out;
}

function buildGarmentGateQuestion(): FashionClarificationQuestion {
  return {
    text: "What are you after?",
    gap: "garment",
    kind: "blocking",
    allow_multiple: true,
    allow_other: true,
    quick_options: [
      "Jeans + tee",
      "Shirt",
      "Dress",
      "Shoes",
      "Coat / jacket",
      "Accessories",
    ],
  };
}

function noteSlotsAddedByClient(params: {
  traceId?: string | null;
  optionLabels: string[];
  resolved: string[];
}): void {
  if (!params.resolved.length) return;
  const chips = params.optionLabels
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && l !== "other" && l !== "add a piece");
  const added = params.resolved.filter((g) => {
    const gl = g.trim().toLowerCase();
    if (!gl) return false;
    return !chips.some(
      (c) =>
        c === gl ||
        c.includes(gl) ||
        gl.includes(c) ||
        garmentSlotFamilyKey(c) === garmentSlotFamilyKey(g),
    );
  });
  if (!added.length) return;
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "intake",
    payload: { kind: "slots_added_by_client", garments: added },
  });
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

function ensureCompleteSizeFamilies(params: {
  questions: FashionClarificationQuestion[];
  brief: FashionSearchBrief | null;
  facts: FashionFactRow[];
  targetPersonId: string | null;
  person?: PersonRow | null;
  profileHints?: IntakeProfileHints | null;
  stated?: FashionStatedFacts | null;
}): FashionClarificationQuestion[] {
  if (!params.targetPersonId) return params.questions;
  if (!params.questions.some((q) => q.gap === "size")) {
    return params.questions;
  }
  const dept =
    params.brief?.department_scope ??
    coercePersonDepartment(params.stated?.department) ??
    getGenderPresentation(params.facts) ??
    departmentFromRelation(params.person?.relation);
  const garments =
    params.brief?.garments?.length
      ? params.brief.garments
      : dept === "womens"
        ? ["blouse", "trousers", "shoes"]
        : ["shirt", "trousers", "shoes"];
  const brief: FashionSearchBrief = params.brief?.garments?.length
    ? params.brief
    : {
        recipient_person_id: params.targetPersonId,
        request_type: params.brief?.request_type ?? "outfit",
        garments,
        occasion_context: params.brief?.occasion_context ?? "general",
        quantity_hint: params.brief?.quantity_hint ?? "a few",
        must_haves: [],
        nice_to_haves: [],
        budget_context: params.brief?.budget_context ?? { stated: false },
        style_direction: params.brief?.style_direction ?? "",
        department_scope: dept ?? undefined,
        stated_facts: params.stated ?? params.brief?.stated_facts,
      };
  const blocking = buildBlockingClarification({
    brief,
    facts: params.facts,
    targetPersonId: params.targetPersonId,
    person: params.person,
    profileHints: params.profileHints,
    stated: params.stated ?? brief.stated_facts,
  });
  const fullSize = normalizeClarificationSizeFields(
    blocking.questions.filter((q) => q.gap === "size"),
  );
  if (fullSize.length <= 1) return params.questions;
  const asked = new Set(sizeFamiliesAskedFromQuestions(params.questions));
  const need = sizeFamiliesAskedFromQuestions(fullSize);
  if (need.every((b) => asked.has(b)) && need.length >= fullSize.length) {
    return params.questions;
  }
  const nonSize = params.questions.filter((q) => q.gap !== "size");
  return [...nonSize, ...fullSize];
}

function clarificationSanitizeOpts(params: {
  people: PersonRow[];
  lastUser?: string;
  stated?: FashionStatedFacts | null;
  /** When shopping for self, rewrite name→you/your in questions. */
  recipientIsSelf?: boolean;
}): {
  rosterNames: string[];
  stripPersonNameQuestions: boolean;
  selfDisplayName?: string | null;
  lastUser?: string;
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
  const self = params.people.find((p) => p.relation === "self");
  const useSelfName =
    params.recipientIsSelf !== false && Boolean(self?.name?.trim());
  return {
    rosterNames,
    stripPersonNameQuestions,
    ...(useSelfName ? { selfDisplayName: self!.name } : {}),
    ...(params.lastUser ? { lastUser: params.lastUser } : {}),
  };
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
    resolvedSlotsGarments?: string[];
    answeredGaps?: FashionClarificationQuestion["gap"][];
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
  if (params.clarificationApply?.resolvedSlotsGarments?.length) {
    fromApply.push({ gap: "slots", source: "clarification_apply" });
  }
  for (const gap of params.clarificationApply?.answeredGaps ?? []) {
    fromApply.push({ gap, source: "clarification_apply" });
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

function refreshPendingBrief(
  pending: FashionPendingBriefMetaV1 | null | undefined,
  brief: FashionSearchBrief,
  recipientId: string,
  slotsGarments?: string[],
): FashionPendingBriefMetaV1 {
  // Slots ticks are sticky: once answered, later size/dept turns must not
  // overwrite them with LLM-invented garments. New slots answers replace.
  const garments = slotsGarments?.length
    ? slotsGarments
    : pending?.brief.garments?.length
      ? pending.brief.garments
      : brief.garments;
  return pendingBriefMeta(
    { ...brief, garments: [...(garments ?? [])] },
    recipientId,
    pending?.consult_rounds_used != null
      ? { consult_rounds_used: pending.consult_rounds_used }
      : undefined,
  );
}

/** Pull-sheet slots answer becomes the brief garments verbatim. */
function applySlotsGarmentsToBrief(
  brief: FashionSearchBrief,
  slotsGarments?: string[],
): FashionSearchBrief {
  if (!slotsGarments?.length) return brief;
  const clean = slotsGarments.filter((g) => {
    const t = g.trim();
    if (!t || t.length > 40 || /[.!?]/.test(t)) return false;
    if (isEscapeOrYouDecideMessage(t, undefined)) return false;
    if (/^(you decide|other|add a piece|ooh nice|hmm|nice)$/i.test(t)) {
      return false;
    }
    if (/\b(looking for|looks?|size|usually)\b/i.test(t) && t.split(/\s+/).length > 3) {
      return false;
    }
    return true;
  });
  // Normalize parts to garment families; empty → reject update, keep prior.
  const recognized = [
    ...new Set(
      clean.flatMap((g) => normalizeGarmentClarificationAnswer(g)),
    ),
  ];
  if (!recognized.length) return brief;
  return { ...brief, garments: recognized };
}

function driftFamilyKey(garment: string): string {
  const k = garmentSlotFamilyKey(garment);
  if (k === "pant" || k === "trouser" || k === "bottom") return "trousers";
  if (k === "sneaker" || k === "trainer") return "sneakers";
  if (k === "shoe") return "shoes";
  if (k === "top") return "shirt";
  return k;
}

function familyKeySetsEqual(a: string[], b: string[]): boolean {
  const sa = new Set(a.map(driftFamilyKey).filter(Boolean));
  const sb = new Set(b.map(driftFamilyKey).filter(Boolean));
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** When slots were answered, brief.garments must match ticked labels. */
function enforceSlotsBriefGarments(params: {
  brief: FashionSearchBrief;
  slotsGarments?: string[];
  traceId?: string | null;
}): FashionSearchBrief {
  const slots = params.slotsGarments;
  if (!slots?.length) return params.brief;
  if (!familyKeySetsEqual(params.brief.garments, slots)) {
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "invariant_warning",
      payload: {
        code: "brief_garments_drift",
        brief_garments: params.brief.garments,
        slots_garments: slots,
      },
    });
    logAiChat("warn", "fashion_invariant_warning", {
      code: "brief_garments_drift",
      brief_garments: params.brief.garments,
      slots_garments: slots,
    });
  }
  return applySlotsGarmentsToBrief(params.brief, slots);
}

function continuationReplyForRemainingSizes(
  questions: FashionClarificationQuestion[],
): string | null {
  const sizeQs = questions.filter((q) => q.gap === "size");
  if (!sizeQs.length || sizeQs.length !== questions.length) return null;
  const families = sizeFamiliesAskedFromQuestions(sizeQs);
  if (!families.length) return null;
  if (families.length === 1) {
    if (families[0] === "shoes") return "And shoes?";
    if (families[0] === "bottoms") return "And bottoms?";
    if (families[0] === "dresses") return "And dresses?";
    return "And tops?";
  }
  const labels = families.map((f) =>
    f === "shoes" ? "shoes" : f === "bottoms" ? "bottoms" : f,
  );
  return `And ${labels.join(" + ")}?`;
}

async function conversationAskedPreferenceAnchor(
  conversationId: string,
): Promise<boolean> {
  return conversationAskedGap(conversationId, "preference_anchor");
}

async function conversationAskedGap(
  conversationId: string,
  gap: string,
): Promise<boolean> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 24,
    select: { metadata: true },
  });
  for (const row of rows) {
    const meta = row.metadata as {
      fashionRouter?: { questions?: Array<{ gap?: string }> };
    } | null;
    if (meta?.fashionRouter?.questions?.some((q) => q.gap === gap)) {
      return true;
    }
  }
  return false;
}

function statedFactsFromRouterResult(
  result: FashionRouterResult,
): FashionStatedFacts | undefined {
  const raw =
    result.move === "ready_to_search"
      ? result.brief.stated_facts
      : result.move === "ask_clarification"
        ? (result.stated_facts ?? result.brief?.stated_facts)
        : undefined;
  if (!raw) return undefined;
  return { ...raw, sizes: sanitizeStatedSizes(raw.sizes) };
}

/**
 * When the user only answered some size families this turn, drop LLM-invented
 * / profile-copied sizes for unnamed families so we re-ask bottoms/shoes after "L".
 */
function clampStatedSizesToAnsweredFamilies(params: {
  stated?: FashionStatedFacts;
  clarificationFacts: FashionFactRow[];
  conversationTexts: string[];
}): FashionStatedFacts | undefined {
  const stated = params.stated;
  if (!stated?.sizes) return stated;
  const answered = params.clarificationFacts
    .filter((f) => f.fact_type === "size" && f.garment_type)
    .map((f) => f.garment_type!.toLowerCase());
  const sizes = clampStatedSizesToNamedFamilies({
    sizes: stated.sizes,
    conversationTexts: params.conversationTexts,
    answeredFamilies: answered,
  });
  return { ...stated, sizes };
}

function provisionalBriefFromAsk(
  result: FashionRouterResult,
): FashionSearchBrief | null {
  return result.move === "ask_clarification" && result.brief
    ? result.brief
    : null;
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
  refinement?: {
    mode: RefinementMode;
    previousSearchId?: string;
    previousPlan?: FashionSearchPlan;
  };
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
  // Self → always "you" so size/dept templates never third-person the client.
  if (person.relation === "self") return "you";
  const name = safeTrim(person.name);
  if (name) return name;
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

function applyStatedDepthFromUserMessage(
  brief: FashionSearchBrief,
  lastUser: string,
): FashionSearchBrief {
  const t = lastUser.trim();
  if (!t) return brief;
  const looksMatch = t.match(
    /\b(\d+)\s*(looks?|tenues?|looks?\s*complets?)\b/i,
  );
  const optionsMatch = t.match(/\b(\d+)\s*(options?|pièces?)\b/i);
  const depth = {
    ...(brief.depth ?? {}),
    source: brief.depth?.source ?? ("assumed" as const),
  };
  let changed = false;
  if (looksMatch) {
    const n = Number(looksMatch[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 8) {
      depth.looks_wanted = n;
      depth.source = "stated";
      changed = true;
    }
  } else if (optionsMatch && brief.request_type === "single_item") {
    const n = Number(optionsMatch[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 8) {
      depth.options_per_item = n;
      depth.source = "stated";
      changed = true;
    }
  }
  // Bare chip "2" / "3" after a depth ask — handled by clarification apply;
  // also catch "2 looks" style in free text above.
  if (!changed) return brief;
  return { ...brief, depth };
}

/** Escape / Just show me: don't invent assumed look counts — you_decide. */
function applyEscapeDepthDefault(
  brief: FashionSearchBrief,
  lastUser: string,
): FashionSearchBrief {
  if (!isEscapeOrYouDecideMessage(lastUser, undefined)) return brief;
  if (brief.depth?.source === "stated") return brief;
  // Drop invented counts — you_decide means no numeric claim.
  return {
    ...brief,
    depth: { source: "you_decide" },
  };
}

function scrubProseGarments(brief: FashionSearchBrief): FashionSearchBrief {
  const out: string[] = [];
  const seen = new Set<string>();
  let droppedProse = false;
  for (const raw of brief.garments ?? []) {
    const g = raw.trim();
    if (!g) continue;
    if (isEscapeOrYouDecideMessage(g, undefined)) {
      droppedProse = true;
      continue;
    }
    if (/^you decide$/i.test(g)) {
      droppedProse = true;
      continue;
    }
    if (g.length > 40 || /[.!?]/.test(g) || /[\u0600-\u06FF]/.test(g)) {
      droppedProse = true;
      for (const t of normalizeGarmentClarificationAnswer(g)) {
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
      }
      continue;
    }
    // Reject non-garment chatter that slipped past the parser
    if (
      /^(thanks?|thank you|ok|okay|sure|yes|no|hi|hey|hello|please|lol|haha|ooh nice|hmm|nice|honestly)$/i.test(
        g,
      )
    ) {
      droppedProse = true;
      continue;
    }
    // Update with no recognizable family after normalize → drop this part.
    const normalized = normalizeGarmentClarificationAnswer(g);
    if (!normalized.length) {
      droppedProse = true;
      continue;
    }
    // Prefer normalized tokens; fall back to original when normalize echoed it.
    for (const t of normalized.length ? normalized : [g]) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  if (out.length) return { ...brief, garments: out };
  // Prose-only list → clear so pending/stated garments can refill.
  if (droppedProse) return { ...brief, garments: [] };
  return brief;
}

function finalizeBriefForSearch(params: {
  brief: FashionSearchBrief;
  person: PersonRow;
  facts: FashionFactRow[];
  signals: StyleSignalRow[];
  sizesUnconfirmed: string[];
  lastUserMessage?: string;
  profileHints?: IntakeProfileHints | null;
  /** Self person facts — honesty always from shopper; philosophy only if self. */
  shopperFacts?: FashionFactRow[];
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

  const shopperMeta = parseOnboardingMetaFromFacts(
    params.shopperFacts ??
      (params.person.relation === "self" ? params.facts : []),
  );
  const honesty = mapHonestyToVoice(shopperMeta?.honesty_preference);
  const voice_context =
    honesty ||
    (params.person.relation === "self" && shopperMeta?.value_philosophy?.trim())
      ? {
          ...(honesty ? { honesty } : {}),
          ...(params.person.relation === "self" &&
          shopperMeta?.value_philosophy?.trim()
            ? { value_philosophy: shopperMeta.value_philosophy.trim() }
            : {}),
        }
      : undefined;

  let occasion_context = params.brief.occasion_context;

  return {
    ...params.brief,
    garments: refineSwimBriefGarments({
      garments: params.brief.garments ?? [],
      mustHaves: must_haves,
      niceToHaves: params.brief.nice_to_haves,
    }),
    must_haves,
    color_direction,
    brand_direction,
    knowledge_state,
    department_scope: params.brief.department_scope ?? knowledge_state.department,
    ...(voice_context ? { voice_context } : {}),
    occasion_context,
  };
}

/** @deprecated Lifestyle→occasion mutate removed; always false. */
export function didInferOccasionFromLifestyle(_params: {
  before: string;
  after: string;
  lifestyleTags?: string[];
}): boolean {
  return false;
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
    params.stated ?? params.brief.stated_facts,
    params.brief.request_type,
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
    lastUserMessage?: string;
  },
  outcome: ResolvedFashionRouterOutcome,
): ResolvedFashionRouterOutcome {
  const result = outcome.routerResult;
  const questions =
    result.move === "ask_clarification" ? result.questions : [];
  const brief =
    result.move === "ready_to_search"
      ? result.brief
      : result.move === "ask_clarification"
        ? result.brief
        : undefined;
  const escapeChip =
    result.move === "ask_clarification" ? result.escape_chip : undefined;
  const sizeAsked = sizeFamiliesAskedFromQuestions(questions);
  const sizeExpected = brief?.garments?.length
    ? sizeBucketsForGarments(brief.garments)
    : [];
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "router",
    payload: {
      consult_rounds_used: outcome.pendingBrief?.consult_rounds_used ?? 0,
      consult_gaps_asked: questions
        .filter(isConsultQuestion)
        .map((q) => q.gap),
      resolution_tap: isEscapeOrYouDecideMessage(
        params.lastUserMessage ?? "",
        escapeChip,
      ),
      assumptions_count: brief?.assumptions?.length ?? 0,
      depth_source: brief?.depth?.source ?? null,
      preference_anchor: brief?.preference_anchor ?? null,
      ...(sizeAsked.length || sizeExpected.length
        ? {
            size_families_asked: sizeAsked,
            size_families_expected: sizeExpected,
            size_families_missing_from_ask: sizeExpected.filter(
              (b) => !sizeAsked.includes(b),
            ),
          }
        : {}),
    },
  });
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
  const gated = await applyVoiceLineReuseGate({
    result: outcome.routerResult,
    context: params.routerContext,
    signal: params.signal,
    traceId: params.traceId ?? params.conversationId,
    deps: params.deps,
  });
  const gatedOutcome = { ...outcome, routerResult: gated };
  return logResolvedRouterTurn(
    {
      traceId: params.traceId,
      conversationId: params.conversationId,
      llmMove,
      lastUserMessage: params.lastUserMessage,
    },
    gatedOutcome,
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
  const [pendingBrief, declinedGaps] = await Promise.all([
    loadPendingBrief(params.conversationId),
    loadDeclinedGaps(params.conversationId),
  ]);

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

  const assembledPeople = params.routerContext.people;
  const assembledFacts = params.routerContext.factsByPersonId;
  const assembledSignals = params.routerContext.signalsByPersonId;
  const hasAssembledMemory =
    Array.isArray(assembledPeople) &&
    assembledFacts instanceof Map &&
    assembledSignals instanceof Map;

  // assembleRouterContext already ensureSelfPerson + loads roster/hints.
  if (isSupabaseAuthUserId(params.userId) && !hasAssembledMemory) {
    await ensureSelfPerson(params.userId);
  }

  const profileHints = hasAssembledMemory
    ? (params.routerContext.profileHints ?? null)
    : isSupabaseAuthUserId(params.userId)
      ? await loadIntakeProfileHints(params.userId)
      : null;

  const { people, factsByPersonId, signalsByPersonId } = hasAssembledMemory
    ? {
        people: assembledPeople,
        factsByPersonId: assembledFacts,
        signalsByPersonId: assembledSignals,
      }
    : await loadPeopleAndFacts({
        userId: params.userId,
        guestSnapshot: params.guestSnapshot,
      });

  let routerResult = await runFashionRouter(
    {
      context: {
        ...params.routerContext,
        consultation_budget_spent:
          (pendingBrief?.consult_rounds_used ?? 0) >= 2,
      },
      signal: params.signal,
      traceId: params.traceId,
    },
    params.deps,
  );
  onLlmMove(routerResult.move);

  // Pending brief resume: only skip non-blocking clarifications. Blocking
  // department/size questions still win over a stale pending brief.
  if (
    pendingBrief &&
    routerResult.move === "ask_clarification" &&
    !questionsHaveConsult(routerResult.questions) &&
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

  const unresolvedSubjects = params.routerContext.unresolvedSubjects ?? [];
  if (unresolvedSubjects.length && !pendingBrief) {
    const alreadyAsked = await conversationAskedGap(
      params.conversationId,
      "recipient",
    );
    routerResult = bundleUnresolvedRecipientAsk({
      result: routerResult,
      subjects: unresolvedSubjects,
      people: peopleNow,
      personShortIds: params.routerContext.personShortIds,
      isRefinement: false,
      alreadyAsked,
    });
  }
  const statedRaw = statedFactsFromRouterResult(routerResult);
  const conversationTexts = [
    ...params.routerContext.conversationMessages
      .filter((m) => m.role === "user")
      .map((m) => m.content),
    lastUser,
  ].filter(Boolean);
  const stated = clampStatedSizesToAnsweredFamilies({
    stated: statedRaw,
    clarificationFacts: clarificationApply?.facts ?? [],
    conversationTexts,
  });
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
    // Merge writes into the in-memory maps — avoid a full roster reload.
    if (applied.person && !peopleNow.some((p) => p.id === applied.person!.id)) {
      peopleNow = [...peopleNow, applied.person];
    }
    if (applied.personId && applied.factsWritten.length > 0) {
      const prev = factsByPersonIdNow.get(applied.personId) ?? [];
      factsByPersonIdNow = new Map(factsByPersonIdNow);
      factsByPersonIdNow.set(
        applied.personId,
        mergeFashionFacts(prev, applied.factsWritten),
      );
    }
  }

  // Clarification answers were written to DB — merge into the in-memory map
  // so this turn's gate sees shoes/tops/etc. without a reload.
  if (clarificationApply?.personId && clarificationApply.facts.length > 0) {
    const pid = clarificationApply.personId;
    const prev = factsByPersonIdNow.get(pid) ?? [];
    factsByPersonIdNow = new Map(factsByPersonIdNow);
    factsByPersonIdNow.set(
      pid,
      mergeFashionFacts(prev, clarificationApply.facts),
    );
  }

  const resolvedGarments = clarificationApply?.resolvedGarments ?? [];
  const resolvedSlotsGarments =
    clarificationApply?.resolvedSlotsGarments ?? [];
  if (resolvedSlotsGarments.length) {
    const slotsQ = clarificationApply?.priorQuestions?.find(
      (q) => q.gap === "slots",
    );
    noteSlotsAddedByClient({
      traceId: params.traceId,
      optionLabels: optionLabels(slotsQ?.quick_options),
      resolved: resolvedSlotsGarments,
    });
  }

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
      const askSignalsEarly = signalsByPersonIdNow.get(targetId ?? "") ?? [];
      const knownClientForSummary =
        facts.length > 0 ||
        askSignalsEarly.length > 0 ||
        Boolean(recipientHintsAsk?.sizeLines?.length);
      let askKnownSummaryInject = goingOnKnownSummary({
        department:
          stated?.department ??
          pendingBrief?.brief.department_scope ??
          null,
        garments:
          pendingBrief?.brief.garments ?? routerResult.brief?.garments,
        sizeLines: recipientHintsAsk?.sizeLines,
        pickHint: pickHintFromProfile({ signals: askSignalsEarly }),
      });
      if (knownClientForSummary && !routerResult.known_summary?.trim()) {
        recordPipelineEvent({
          traceId: params.traceId,
          stage: "gate",
          payload: { kind: "known_summary_missing", phase: "assert" },
        });
        // Prefer deterministic inject when profile bits exist; else one LLM retry.
        if (askKnownSummaryInject) {
          routerResult = {
            ...routerResult,
            known_summary: askKnownSummaryInject,
          };
          recordPipelineEvent({
            traceId: params.traceId,
            stage: "gate",
            payload: { kind: "known_summary_injected" },
          });
          logAiChat("info", "known_summary_injected", {
            traceId: params.traceId,
          });
        } else {
          try {
            const note =
              "Ask known_summary, phrased around one concrete profile fact (size, lane, or last pick); do not reuse prior wording.";
            const retried = await runFashionRouter(
              {
                context: params.routerContext,
                signal: params.signal,
                gateNote: note,
                traceId: params.traceId,
                stage: "gate_retry",
              },
              params.deps,
            );
            if (
              retried.move === "ask_clarification" &&
              retried.known_summary?.trim()
            ) {
              routerResult = {
                ...routerResult,
                known_summary: retried.known_summary.trim(),
              };
            }
          } catch {
            /* leave absent — check will fail */
          }
        }
      }
      // Template gate: present but empty/formulaic → retry once, then inject.
      if (
        routerResult.move === "ask_clarification" &&
        routerResult.known_summary?.trim() &&
        !knownSummaryPassesTemplate(routerResult.known_summary)
      ) {
        recordPipelineEvent({
          traceId: params.traceId,
          stage: "gate",
          payload: { kind: "known_summary_template_fail" },
        });
        try {
          const note =
            "Ask known_summary, phrased around one concrete fact (size, department, or last pick); do not reuse prior wording or log dumps.";
          const retried = await runFashionRouter(
            {
              context: params.routerContext,
              signal: params.signal,
              gateNote: note,
              traceId: params.traceId,
              stage: "gate_retry",
            },
            params.deps,
          );
          if (
            retried.move === "ask_clarification" &&
            knownSummaryPassesTemplate(retried.known_summary)
          ) {
            routerResult = {
              ...routerResult,
              known_summary: retried.known_summary!.trim(),
            };
          } else if (askKnownSummaryInject) {
            routerResult = {
              ...routerResult,
              known_summary: askKnownSummaryInject,
            };
          }
        } catch {
          if (askKnownSummaryInject) {
            routerResult = {
              ...routerResult,
              known_summary: askKnownSummaryInject,
            };
          }
        }
      }
      if (routerResult.known_summary?.trim()) {
        askKnownSummaryInject = routerResult.known_summary.trim();
      }
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

      const llmProvisional = provisionalBriefFromAsk(routerResult);
      const sizeBrief =
        llmProvisional ??
        pendingBrief?.brief ??
        (garmentBrief.garments.length
          ? ({
              recipient_person_id: targetId ?? "self",
              request_type: "outfit",
              garments: garmentBrief.garments,
              occasion_context: "general",
              quantity_hint: "a few",
              must_haves: [],
              nice_to_haves: [],
              budget_context: { stated: false },
              style_direction: "",
              department_scope: garmentBrief.department_scope,
              stated_facts: stated ?? undefined,
            } satisfies FashionSearchBrief)
          : null);
      questions = ensureCompleteSizeFamilies({
        questions,
        brief: sizeBrief,
        facts,
        targetPersonId: targetId,
        person: peopleNow.find((p) => p.id === targetId) ?? null,
        profileHints: recipientHintsAsk,
        stated,
      });

      const askSignals = signalsByPersonIdNow.get(targetId ?? "") ?? [];
      const askBriefGarments =
        sizeBrief?.garments ??
        garmentBrief.garments ??
        routerResult.brief?.garments ??
        [];
      const anchorRelevant = profileHasRelevantAnchorSignal({
        garments: askBriefGarments,
        signals: askSignals,
        facts,
      });
      const preferenceAnchorAsked = await conversationAskedPreferenceAnchor(
        params.conversationId,
      );
      const escapeThisTurn = isEscapeOrYouDecideMessage(
        lastUser,
        routerResult.move === "ask_clarification"
          ? routerResult.escape_chip
          : undefined,
      );

      // Escape after sizes already asked → drop size re-ask (unconfirmed ok).
      if (escapeThisTurn && questions.some((q) => q.gap === "size")) {
        const sizeAskedBefore = await conversationAskedGap(
          params.conversationId,
          "size",
        );
        if (sizeAskedBefore) {
          questions = questions.filter((q) => q.gap !== "size");
        }
      }

      // Never re-ask preference_anchor; strip when profile doesn't overlap.
      questions = questions.filter((q) => {
        if (q.gap !== "preference_anchor") return true;
        if (!anchorRelevant) return false;
        if (preferenceAnchorAsked) return false;
        if (isGapAnswered(answeredLedger, "preference_anchor")) return false;
        return true;
      });

      // Escape on an anchor question → unspecified + spoken assumption (never keep).
      if (
        escapeThisTurn &&
        preferenceAnchorAsked &&
        !questions.some((q) => q.gap === "size" || q.gap === "department")
      ) {
        const baseBrief =
          sizeBrief ??
          pendingBrief?.brief ??
          routerResult.brief ??
          null;
        if (baseBrief && askBriefGarments.length) {
          routerResult = {
            move: "ready_to_search",
            brief: {
              ...baseBrief,
              garments: baseBrief.garments.length
                ? baseBrief.garments
                : askBriefGarments,
              preference_anchor: "unspecified",
              assumptions: [
                ...(baseBrief.assumptions ?? []),
                ANCHOR_KEEP_ASSUMPTION,
              ].filter((v, i, a) => a.indexOf(v) === i),
              stated_facts: stated ?? baseBrief.stated_facts,
            },
          };
        }
      }

      const pendingWithGarments =
        resolvedGarments.length && targetId
          ? pendingBriefMeta(
              applyResolvedGarmentsToBrief(
                pendingBrief?.brief ??
                  llmProvisional ??
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
            : llmProvisional && targetId
              ? pendingBriefMeta(
                  applyResolvedGarmentsToBrief(llmProvisional, resolvedGarments),
                  targetId,
                )
              : null;

      const hadConsult = questionsHaveConsult(single.questions);
      if (routerResult.move === "ready_to_search") {
        // Escape-after-anchor upgrade — fall through to ready path below.
      } else if (!questions.length && pendingWithGarments && !hadConsult) {
        routerResult = {
          move: "ready_to_search",
          brief: {
            ...pendingWithGarments.brief,
            stated_facts: stated ?? pendingWithGarments.brief.stated_facts,
          },
        };
      } else if (
        !questions.length &&
        (escapeThisTurn || !hadConsult)
      ) {
        // Questions satisfied — or client escaped after consults were stripped.
        try {
          const { buildFallbackBriefFromContext } = await import(
            "../observability/fallback-brief"
          );
          const fallback = buildFallbackBriefFromContext({
            context: params.routerContext,
            reason: "clarification_questions_satisfied",
            pendingBrief: pendingWithGarments ?? pendingBrief,
          });
          if (fallback) {
            const brief = {
              ...applyResolvedGarmentsToBrief(
                fallback.brief,
                resolvedGarments,
              ),
              ...(escapeThisTurn && preferenceAnchorAsked
                ? {
                    preference_anchor: "unspecified" as const,
                    assumptions: [
                      ...(fallback.brief.assumptions ?? []),
                      ANCHOR_KEEP_ASSUMPTION,
                    ].filter((v, i, a) => a.indexOf(v) === i),
                  }
                : {}),
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
                        "Shirt or top",
                        "Dress",
                        "Shoes",
                        "Accessories",
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
                      "Shirt or top",
                      "Dress",
                      "Shoes",
                      "Accessories",
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
                    "Shirt or top",
                    "Dress",
                    "Shoes",
                    "Accessories",
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
      } else if (routerResult.move === "ask_clarification") {
        const sizeContinuation = continuationReplyForRemainingSizes(questions);
        return {
          routerResult: withClarificationDefaults(
            {
              ...routerResult,
              ...(sizeContinuation ? { reply: sizeContinuation } : {}),
              questions,
              target_person_id: targetId ?? routerResult.target_person_id,
              stated_facts: stated,
              brief:
                routerResult.brief && resolvedSlotsGarments.length
                  ? applySlotsGarmentsToBrief(
                      routerResult.brief,
                      resolvedSlotsGarments,
                    )
                  : routerResult.brief,
            },
            params.traceId,
            {
              ...sanitizeOpts,
              signals: askSignals,
              ...(askKnownSummaryInject
                ? { knownSummary: askKnownSummaryInject }
                : {}),
              lastUser,
            },
          ),
          pendingBrief: (pendingWithGarments ?? pendingBrief)
            ? pendingBriefMeta(
                applySlotsGarmentsToBrief(
                  (pendingWithGarments ?? pendingBrief)!.brief,
                  resolvedSlotsGarments,
                ),
                (pendingWithGarments ?? pendingBrief)!.recipientPersonId,
                {
                  consult_rounds_used: nextConsultRoundsUsed({
                    pending: pendingBrief,
                    brief: (pendingWithGarments ?? pendingBrief)!.brief,
                    questions,
                  }),
                },
              )
            : pendingBrief,
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

  let brief = enforceSlotsBriefGarments({
    brief: applyResolvedGarmentsToBrief(
      applyDepartmentFromUserMessage(routerResult.brief, lastUser),
      resolvedGarments,
    ),
    slotsGarments: resolvedSlotsGarments,
    traceId: params.traceId,
  });
  const answeredClarification = Boolean(
    clarificationApply &&
      (clarificationApply.facts.length > 0 ||
        clarificationApply.resolvedGarments?.length ||
        clarificationApply.resolvedSlotsGarments?.length ||
        clarificationApply.raisedBudgetMax != null ||
        clarificationApply.declineBudgetRaise),
  );
  if (
    pendingBrief &&
    (answeredClarification ||
      /\bwhat size\b/i.test(brief.style_direction) ||
      /\busually wear\b/i.test(brief.style_direction))
  ) {
    brief = resumePendingShoppingBrief(pendingBrief.brief, brief);
    brief = applyResolvedGarmentsToBrief(brief, resolvedGarments);
    brief = enforceSlotsBriefGarments({
      brief,
      slotsGarments: resolvedSlotsGarments,
      traceId: params.traceId,
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "brief_resumed",
      payload: {
        reason: "pending_shopping_intent",
        brief,
        saved_at: pendingBrief.savedAt,
      },
    });
  }
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
  const readySignals = signalsByPersonIdNow.get(recipientId) ?? [];
  const readyPickHint = pickHintFromProfile({ signals: readySignals });
  const readyKnownSummary = goingOnKnownSummary({
    department: brief.department_scope,
    garments: brief.garments,
    sizeLines: recipientHints?.sizeLines,
    pickHint: readyPickHint,
  });
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
    const gateSanitizeOpts = clarificationSanitizeOpts({
      people: peopleNow,
      lastUser,
      stated: stated ?? brief.stated_facts,
    });

    // v2: dept/size-only gaps are fully covered by deterministic templates —
    // skip the gate_retry LLM (saves a Haiku call on the common path).
    // Keep LLM retry only when recipient is still unresolved (should not reach
    // here) or when we later expand blocking gaps beyond dept/size.
    const deterministicOnly = Boolean(person);

    if (deterministicOnly) {
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
            gate_path: "deterministic",
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
            {
              ...gateSanitizeOpts,
              signals: signalsByPersonIdNow.get(recipientId) ?? [],
              ...(readyKnownSummary
                ? { knownSummary: readyKnownSummary }
                : {}),
            },
          ),
          pendingBrief: refreshPendingBrief(pendingBrief, brief, recipientId, resolvedSlotsGarments),
          clearPendingBrief: false,
          recipientPersonId: recipientId,
          recipientFacts: facts,
          sizesUnconfirmed: [],
          declinedGaps: activeDeclined,
        };
      }
      // All remaining gaps declined or satisfied — fall through to search.
    } else {
      const gaps: string[] = [];
      if (gapExplain.missing_department) gaps.push("department");
      for (const b of gapExplain.missing_size_buckets) gaps.push(`size (${b})`);
      const gateNote = `Ask ${gaps.join(" and ") || "the remaining blocking gap"}, phrased around ${personLabel(person)}; do not reuse prior wording. Use ask_clarification.`;

      const retried = await runFashionRouter(
        {
          context: params.routerContext,
          signal: params.signal,
          gateNote,
          traceId: params.traceId,
          stage: "gate_retry",
        },
        params.deps,
      );

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
              gate_path: "retry_llm",
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
              {
                ...gateSanitizeOpts,
                signals: signalsByPersonIdNow.get(recipientId) ?? [],
              },
            ),
            pendingBrief: refreshPendingBrief(pendingBrief, brief, recipientId, resolvedSlotsGarments),
            clearPendingBrief: false,
            recipientPersonId: recipientId,
            recipientFacts: facts,
            sizesUnconfirmed: [],
            declinedGaps: activeDeclined,
          };
        }
      }

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
            gate_path: "deterministic",
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
            {
              ...gateSanitizeOpts,
              signals: signalsByPersonIdNow.get(recipientId) ?? [],
              ...(readyKnownSummary
                ? { knownSummary: readyKnownSummary }
                : {}),
            },
          ),
          pendingBrief: refreshPendingBrief(pendingBrief, brief, recipientId, resolvedSlotsGarments),
          clearPendingBrief: false,
          recipientPersonId: recipientId,
          recipientFacts: facts,
          sizesUnconfirmed: [],
          declinedGaps: activeDeclined,
        };
      }
    }
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
          {
            ...clarificationSanitizeOpts({
              people: peopleNow,
              lastUser,
              stated: stated ?? brief.stated_facts,
            }),
            ...(readyKnownSummary
              ? { knownSummary: readyKnownSummary }
              : {}),
          },
        ),
        pendingBrief: refreshPendingBrief(pendingBrief, brief, recipientId, resolvedSlotsGarments),
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

  const occasionBefore = brief.occasion_context;
  const selfPerson = peopleNow.find((p) => p.relation === "self");
  const shopperFacts =
    selfPerson != null
      ? (factsByPersonIdNow.get(selfPerson.id) ?? [])
      : person?.relation === "self"
        ? facts
        : [];

  {
    const recipientSignals = signalsByPersonIdNow.get(recipientId) ?? [];
    const lastAssistantWasCuration = [...params.routerContext.conversationMessages]
      .reverse()
      .some(
        (m) =>
          m.role === "assistant" &&
          m.content.length > 80 &&
          /\b(look|looks|pulled|fitting room|here(?:'s| are))\b/i.test(
            m.content,
          ),
      );
    const lastBriefGarments =
      pendingBrief?.brief.garments ??
      (lastAssistantWasCuration ? brief.garments : null);
    const preferenceAnchorAsked = await conversationAskedPreferenceAnchor(
      params.conversationId,
    );

    const fromWordsLast = parsePreferenceAnchorFromWords(lastUser);
    // Scan user turns after preference_anchor was asked (ledger), not only
    // reply text that happens to contain "usual".
    let fromWordsHistory: "keep" | "push" | "explore" | null = null;
    if (preferenceAnchorAsked) {
      for (const m of params.routerContext.conversationMessages) {
        if (m.role !== "user") continue;
        const w = parsePreferenceAnchorFromWords(m.content);
        if (w) fromWordsHistory = w;
      }
    }
    const fromWords = fromWordsLast ?? fromWordsHistory;
    // Words always win when present.
    if (fromWords) {
      brief = {
        ...brief,
        preference_anchor: fromWords,
        assumptions: (brief.assumptions ?? []).filter(
          (a) => !/usual lane|say the word for something new/i.test(a),
        ),
      };
    } else if (
      brief.preference_anchor &&
      brief.preference_anchor !== "unspecified" &&
      !preferenceAnchorAsked
    ) {
      // No chip/words and never asked — never trust LLM invent.
      brief = {
        ...brief,
        preference_anchor: "unspecified",
        assumptions: [
          ...(brief.assumptions ?? []),
          ANCHOR_KEEP_ASSUMPTION,
        ].filter((v, i, a) => a.indexOf(v) === i),
      };
    }

    let anchorDecision = decideAnchorGate({
      brief,
      signals: recipientSignals,
      facts,
      lastUserMessage: lastUser,
      lastAssistantWasCuration,
      lastBriefGarments,
      alreadyRetried: false,
      preferenceAnchorAsked,
    });

    // Confirmed chip/words already on the brief — never force-keep over them.
    if (
      brief.preference_anchor &&
      brief.preference_anchor !== "unspecified" &&
      anchorDecision.action === "force_keep"
    ) {
      anchorDecision = { action: "pass" };
    }

    // Reject ready_to_search with unspecified on overlapping known clients —
    // land the ask in code (no LLM round). One retry path remains for
    // alreadyRetried → force_keep + spoken assumption.
    if (anchorDecision.action === "ask") {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: { kind: "anchor_gate_fired", phase: "deterministic_ask" },
      });
      const anchorSummary = goingOnKnownSummary({
        department: brief.department_scope,
        garments: brief.garments,
        sizeLines: recipientHints?.sizeLines,
        pickHint: pickHintFromProfile({ signals: recipientSignals }),
      });
      return {
        routerResult: withClarificationDefaults(
          {
            move: "ask_clarification",
            reply: anchorDecision.question.text,
            questions: [anchorDecision.question],
            brief,
            ...(anchorSummary ? { known_summary: anchorSummary } : {}),
          },
          params.traceId,
          {
            ...clarificationSanitizeOpts({
              people: peopleNow,
              lastUser,
              stated: stated ?? brief.stated_facts,
            }),
            signals: recipientSignals,
            ...(anchorSummary ? { knownSummary: anchorSummary } : {}),
          },
        ),
        pendingBrief: refreshPendingBrief(pendingBrief, brief, recipientId, resolvedSlotsGarments),
        clearPendingBrief: false,
        recipientPersonId: recipientId,
        recipientFacts: facts,
        sizesUnconfirmed,
        declinedGaps: activeDeclined,
      };
    }

    if (anchorDecision.action === "force_keep") {
      brief = anchorDecision.brief;
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: {
          kind: "anchor_gate_fired",
          phase: "force_keep",
          assumption: anchorDecision.assumption,
        },
      });
    }
  }

  brief = applyStatedDepthFromUserMessage(brief, lastUser);
  brief = applyEscapeDepthDefault(brief, lastUser);
  brief = scrubProseGarments(brief);
  // After scrub cleared prose, restore pending garments (slots escape path).
  if (
    !brief.garments.length &&
    pendingBrief?.brief.garments?.length
  ) {
    brief = scrubProseGarments({
      ...brief,
      garments: [...pendingBrief.brief.garments],
    });
  }
  const mineUsers = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const reject =
      /^(keep|push|explore|unspecified|you decide|just show me|thanks?|ok|okay|sure|yes|no)$/i;
    for (const m of params.routerContext.conversationMessages) {
      if (m.role !== "user") continue;
      for (const g of normalizeGarmentClarificationAnswer(m.content)) {
        const k = g.toLowerCase().trim();
        if (!k || reject.test(k) || seen.has(k)) continue;
        seen.add(k);
        out.push(g);
      }
    }
    return out;
  };
  const priorHadSlots = clarificationApply?.priorQuestions?.some(
    (q) => q.gap === "slots" || q.gap === "garment",
  );
  const slotsEmpty = !clarificationApply?.resolvedSlotsGarments?.length;
  const minedAll = mineUsers();
  const briefJunk = (brief.garments ?? []).every(
    (g) =>
      !g.trim() ||
      isEscapeOrYouDecideMessage(g, undefined) ||
      /^you decide$/i.test(g.trim()) ||
      /^(keep|push|explore)$/i.test(g.trim()),
  );
  // Prefer mined garments when brief is empty/junk, or slots escaped with a
  // generic multi-piece LLM outfit while the user named specific pieces.
  if (
    minedAll.length &&
    (!brief.garments.length ||
      briefJunk ||
      (priorHadSlots &&
        slotsEmpty &&
        brief.garments.length >= 3 &&
        minedAll.length <= 3))
  ) {
    brief = { ...brief, garments: minedAll };
  }
  // Slots ticks stick: after size/escape, pending (or mined slots answer)
  // wins over LLM invent. Must run AFTER mineUsers so we don't lose the set.
  if (!clarificationApply?.resolvedSlotsGarments?.length) {
    const pendingG = (pendingBrief?.brief.garments ?? []).filter(
      (g) =>
        g.trim() &&
        !isEscapeOrYouDecideMessage(g, undefined) &&
        g.trim().length <= 40,
    );
    const slotsAsked = await conversationAskedGap(
      params.conversationId,
      "slots",
    );
    if (slotsAsked && pendingG.length >= 2) {
      brief = applySlotsGarmentsToBrief(brief, pendingG);
    } else if (
      slotsAsked &&
      minedAll.length >= 2 &&
      !familyKeySetsEqual(brief.garments, minedAll)
    ) {
      brief = applySlotsGarmentsToBrief(brief, minedAll);
    }
  }
  // Never ship invented assumed look counts — treat as you_decide.
  if (brief.depth?.source === "assumed") {
    brief = { ...brief, depth: { source: "you_decide" } };
  }

  // Chip→brief consistency: depth/slots/color/budget answered this turn.
  {
    const priorQs = clarificationApply?.priorQuestions ?? [];
    const flat = clarificationApply?.flatAnswers ?? {};
    const chips = chipsFromClarificationTurn({
      questions: priorQs,
      userMessage: lastUser,
      answers: flat,
      slotsGarments: clarificationApply?.resolvedSlotsGarments,
    });
    // Prefer slots garments already on brief from enforceSlotsBriefGarments
    if (
      !chips.slotsGarments?.length &&
      clarificationApply?.resolvedSlotsGarments?.length
    ) {
      chips.slotsGarments = clarificationApply.resolvedSlotsGarments;
    }
    const mismatches = findConsistencyMismatches({ brief, chips });
    if (
      chips.depthLooks != null ||
      chips.depthYouDecide ||
      chips.depthOptions != null ||
      chips.slotsGarments?.length ||
      chips.color ||
      chips.budgetMax != null ||
      chips.preferenceAnchor
    ) {
      const gaps: ConsistencyGap[] = [
        ...(chips.depthLooks != null ||
        chips.depthYouDecide ||
        chips.depthOptions != null
          ? (["depth"] as ConsistencyGap[])
          : []),
        ...(chips.slotsGarments?.length
          ? (["slots"] as ConsistencyGap[])
          : []),
        ...(chips.color ? (["color"] as ConsistencyGap[]) : []),
        ...(chips.budgetMax != null ? (["budget"] as ConsistencyGap[]) : []),
        ...(chips.preferenceAnchor
          ? (["preference_anchor"] as ConsistencyGap[])
          : []),
      ];
      if (mismatches.length) {
        // Chip is ground truth: hard-set immediately (LLM retry would race
        // the same chips). Log each gap for hard-set rate reporting.
        brief = hardSetBriefFromChips(brief, chips, gaps);
        for (const m of mismatches) {
          noteBriefHardset(m.gap);
          recordPipelineEvent({
            traceId: params.traceId,
            stage: "gate",
            payload: {
              kind: "brief_hardset",
              gap: m.gap,
              chip: m.chip,
              brief_was: m.brief,
            },
          });
          logAiChat("info", "brief_hardset", {
            gap: m.gap,
            chip: m.chip,
            brief_was: m.brief,
            traceId: params.traceId,
          });
        }
      } else {
        // Soft-align source labels even when values already match.
        brief = hardSetBriefFromChips(brief, chips, gaps);
      }
    }
  }

  // Normalize compound / localized garment labels after chip hard-set.
  if (brief.garments.length) {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const g of brief.garments) {
      const parts =
        /[/|]/.test(g) || /[\u0600-\u06FF]/.test(g)
          ? normalizeGarmentClarificationAnswer(g)
          : [g];
      for (const p of parts) {
        const k = p.toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        normalized.push(p);
      }
    }
    if (normalized.length) brief = { ...brief, garments: normalized };
  }

  // Outfit/capsule must not ready with assumed depth while the client is
  // still answering — ask depth (pull-sheet) once.
  {
    const needsDepthAsk =
      (brief.request_type === "outfit" || brief.request_type === "capsule") &&
      brief.depth?.source !== "stated" &&
      brief.depth?.source !== "you_decide" &&
      !isEscapeOrYouDecideMessage(lastUser, undefined) &&
      !(pendingBrief?.consult_rounds_used != null && pendingBrief.consult_rounds_used >= 2);
    const depthAlreadyAsked = await conversationAskedGap(
      params.conversationId,
      "depth",
    );
    if (needsDepthAsk && !depthAlreadyAsked) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: { kind: "depth_gate_fired", phase: "deterministic_ask" },
      });
      return {
        routerResult: withClarificationDefaults(
          {
            move: "ask_clarification",
            reply: "How many looks should I pull?",
            questions: [
              {
                text: "How many looks?",
                gap: "depth",
                kind: "consult",
                quick_options: ["2 looks", "3 looks", "5 looks", "You decide"],
              },
            ],
            brief,
            known_summary: formatKnownSummarySpeech({
              department: brief.department_scope,
              garments: brief.garments,
            }),
          },
          params.traceId,
          clarificationSanitizeOpts({
            people: peopleNow,
            lastUser,
            stated: stated ?? brief.stated_facts,
          }),
        ),
        pendingBrief: refreshPendingBrief(pendingBrief, brief, recipientId, resolvedSlotsGarments),
        clearPendingBrief: false,
        recipientPersonId: recipientId,
        recipientFacts: facts,
        sizesUnconfirmed,
        declinedGaps: activeDeclined,
      };
    }
  }

  // Unnamed brief garments: client never wrote these families and never
  // answered slots/garment this appointment → reject once.
  // multi_item / single_item → free-text garment ask (never slots for multi).
  // outfit / capsule → slots checklist.
  {
    const ledger = answeredLedgerFromClarificationApply({
      clarificationApply,
      stated: stated ?? brief.stated_facts,
      facts,
      profileHints: recipientHints,
    });
    const slotsAnswered =
      Boolean(clarificationApply?.resolvedSlotsGarments?.length) ||
      isGapAnswered(ledger, "slots");
    const garmentAnswered =
      Boolean(clarificationApply?.resolvedGarments?.length) ||
      isGapAnswered(ledger, "garment");
    const named = clientNamedGarmentFamilies(
      params.routerContext.conversationMessages,
    );
    if (lastUser) {
      for (const id of familyIdsMentionedInText(lastUser)) named.add(id);
      for (const g of normalizeGarmentClarificationAnswer(lastUser)) {
        named.add(garmentFamilyId(g));
      }
    }
    const pickEvents =
      params.routerContext.recentRequestEventsByPersonId?.get(recipientId) ??
      [];
    for (const k of garmentFamiliesFromRequestEvents(pickEvents)) {
      named.add(garmentFamilyId(k));
    }
    const unnamed = briefGarmentsUnnamedByClient({
      garments: brief.garments ?? [],
      namedFamilies: named,
    });
    const multiEmpty =
      brief.request_type === "multi_item" &&
      !hasConcreteGarmentDirection(brief.garments ?? []);
    const needsConfirm =
      (unnamed.length > 0 || multiEmpty) &&
      !slotsAnswered &&
      !garmentAnswered &&
      !isEscapeOrYouDecideMessage(lastUser, undefined);
    const slotsAlreadyAsked = await conversationAskedGap(
      params.conversationId,
      "slots",
    );
    const garmentAlreadyAsked = await conversationAskedGap(
      params.conversationId,
      "garment",
    );
    const alreadyAsked = slotsAlreadyAsked || garmentAlreadyAsked;

    if (needsConfirm && !alreadyAsked) {
      const useGarmentAsk =
        brief.request_type === "multi_item" ||
        brief.request_type === "single_item" ||
        multiEmpty;
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: {
          kind: useGarmentAsk ? "garment_gate_fired" : "slots_gate_fired",
          note: useGarmentAsk ? "ask garment" : "ask slots",
          unnamed,
        },
      });
      const question = useGarmentAsk
        ? buildGarmentGateQuestion()
        : buildSlotsGateQuestion(brief);
      return {
        routerResult: withClarificationDefaults(
          {
            move: "ask_clarification",
            reply: question.text,
            questions: [question],
            brief,
            known_summary: formatKnownSummarySpeech({
              department: brief.department_scope,
              garments: brief.garments,
            }),
          },
          params.traceId,
          clarificationSanitizeOpts({
            people: peopleNow,
            lastUser,
            stated: stated ?? brief.stated_facts,
          }),
        ),
        pendingBrief: refreshPendingBrief(
          pendingBrief,
          brief,
          recipientId,
          resolvedSlotsGarments,
        ),
        clearPendingBrief: false,
        recipientPersonId: recipientId,
        recipientFacts: facts,
        sizesUnconfirmed,
        declinedGaps: activeDeclined,
      };
    }
  }

  brief = finalizeBriefForSearch({
    brief,
    person: person!,
    facts,
    signals: signalsByPersonIdNow.get(recipientId) ?? [],
    sizesUnconfirmed,
    lastUserMessage: lastUser,
    profileHints: recipientHints,
    shopperFacts,
  });

  // Durable gender beats LLM mixed/wrong — unless this turn explicitly Mix it.
  brief = applyDurableDepartmentScope({
    brief,
    facts,
    person: person!,
    profileHints: recipientHints,
    stated: stated ?? brief.stated_facts,
  });

  const shopperMeta = parseOnboardingMetaFromFacts(shopperFacts);
  const occasionInferred = didInferOccasionFromLifestyle({
    before: occasionBefore,
    after: brief.occasion_context,
    lifestyleTags: shopperMeta?.lifestyle_tags,
  });
  recordReadyToSearchOutcome({
    gatePath: "clean",
    occasionInferred,
  });

  if (recipientHints?.genderPresentation && !brief.department_scope) {
    brief = { ...brief, department_scope: recipientHints.genderPresentation };
  }

  brief = applyDepartmentFromRelation(brief, person);
  // Re-apply durable after relation fill — relation never overrides known self gender.
  brief = applyDurableDepartmentScope({
    brief,
    facts,
    person: person!,
    profileHints: recipientHints,
    stated: stated ?? brief.stated_facts,
  });
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

  let lastScreen: Awaited<ReturnType<typeof loadLastOnScreenSearch>> = null;
  try {
    lastScreen = await loadLastOnScreenSearch(params.conversationId);
  } catch {
    lastScreen = null;
  }
  const refinementMode = classifyRefinementMode(lastScreen?.brief, brief);
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "brief_persisted",
    payload: {
      brief,
      recipient_person_id: recipientId,
      knowledge_state: brief.knowledge_state,
      refinement_mode: refinementMode,
    },
  });

  const spokenReady = buildPullLine({
    lastUser,
    garments: brief.garments,
    occasion: brief.occasion_context,
    depthLooks: brief.depth?.looks_wanted ?? null,
  });
  const llmPull =
    routerResult.move === "ready_to_search"
      ? routerResult.pull_line?.trim()
      : undefined;
  const pull_line = llmPull || spokenReady;
  if (!llmPull) {
    logAiChat("info", "pull_line_fallback", {
      traceId: params.traceId,
      pull_line,
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "gate",
      payload: { kind: "pull_line_fallback", pull_line },
    });
  }
  return {
    routerResult: {
      move: "ready_to_search",
      brief,
      pull_line,
      reply: pull_line,
      ...(readyKnownSummary ? { known_summary: readyKnownSummary } : {}),
    },
    pendingBrief: pendingBrief ?? null,
    clearPendingBrief: true,
    recipientPersonId: recipientId,
    recipientFacts: facts,
    sizesUnconfirmed,
    declinedGaps: activeDeclined,
    refinement: {
      mode: refinementMode,
      ...(lastScreen
        ? {
            previousSearchId: lastScreen.searchId,
            previousPlan: lastScreen.plan,
          }
        : {}),
    },
  };
}

export { pendingBriefMeta, loadPendingBrief };
