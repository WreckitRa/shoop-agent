/**
 * Conversation-fact consumers for code-side clarification guards.
 *
 * Principle: a guard may OVERRIDE the LLM only where the guard's information
 * is strictly better (DB facts, schemas). Where the LLM's information is
 * better — anything stated in the conversation — the guard must CONSUME
 * stated_facts / the asked-and-answered ledger, never re-derive from a
 * weaker source and never override from ignorance.
 */
import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";
import type {
  FashionClarificationGap,
  FashionClarificationQuestion,
  FashionStatedFacts,
} from "../router/types";
import type { FashionFactRow } from "../types";
import { getGenderPresentation, hasSizeForBucket } from "./identity-gate";
import type { IntakeProfileHints } from "./account-profile-bridge";
import type { SizeGarmentBucket } from "./garment-size-fields";
import { hasConcreteGarmentDirection } from "./garment-answer";

export type AnsweredGapEntry = {
  gap: FashionClarificationGap;
  garment_type?: string;
  /** Where the answer was observed. */
  source: "stated_facts" | "clarification_apply" | "facts" | "ledger";
};

function sizeBucketKey(bucket: string | undefined): string | undefined {
  if (!bucket) return undefined;
  const t = bucket.trim().toLowerCase();
  if (t === "tops" || t === "bottoms" || t === "shoes" || t === "dresses") {
    return t;
  }
  return undefined;
}

/** Gaps covered by conversation stated_facts (router reading). */
export function answeredGapsFromStatedFacts(
  stated?: FashionStatedFacts | null,
): AnsweredGapEntry[] {
  if (!stated) return [];
  const out: AnsweredGapEntry[] = [];
  if (stated.department) {
    out.push({ gap: "department", source: "stated_facts" });
  }
  const sizes = stated.sizes;
  if (sizes?.tops?.trim()) {
    out.push({ gap: "size", garment_type: "tops", source: "stated_facts" });
  }
  if (sizes?.bottoms?.trim()) {
    out.push({ gap: "size", garment_type: "bottoms", source: "stated_facts" });
  }
  if (sizes?.shoes?.trim()) {
    out.push({ gap: "size", garment_type: "shoes", source: "stated_facts" });
  }
  if (sizes?.dresses?.trim()) {
    out.push({ gap: "size", garment_type: "dresses", source: "stated_facts" });
  }
  if (stated.budget?.max != null) {
    out.push({ gap: "budget", source: "stated_facts" });
  }
  // WHO is known only when the router named a concrete person or introduced one.
  if (stated.person_ref === "new" && stated.new_person) {
    out.push({ gap: "recipient", source: "stated_facts" });
    if (stated.new_person.name?.trim()) {
      out.push({ gap: "person_name", source: "stated_facts" });
    }
  } else if (
    stated.person_ref &&
    stated.person_ref !== "new" &&
    stated.person_ref.trim().length > 0
  ) {
    out.push({ gap: "recipient", source: "stated_facts" });
  }
  return out;
}

/** Gaps already present as durable facts (post-registration knowledge_state). */
export function answeredGapsFromFacts(
  facts: FashionFactRow[],
  profileHints?: IntakeProfileHints | null,
): AnsweredGapEntry[] {
  const out: AnsweredGapEntry[] = [];
  if (
    getGenderPresentation(facts) != null ||
    profileHints?.genderPresentation
  ) {
    out.push({ gap: "department", source: "facts" });
  }
  for (const bucket of ["tops", "bottoms", "shoes", "dresses"] as const) {
    if (hasSizeForBucket(facts, bucket, profileHints)) {
      out.push({ gap: "size", garment_type: bucket, source: "facts" });
    }
  }
  return out;
}

function gapMatchKey(gap: FashionClarificationGap, garmentType?: string): string {
  return `${gap}|${sizeBucketKey(garmentType) ?? ""}`;
}

export function isGapAnswered(
  ledger: AnsweredGapEntry[],
  gap: FashionClarificationGap,
  garmentType?: string,
): boolean {
  const key = gapMatchKey(gap, garmentType);
  return ledger.some((e) => gapMatchKey(e.gap, e.garment_type) === key);
}

/**
 * Merge ledgers — later sources do not replace earlier ones; union by key.
 */
export function mergeAnsweredLedgers(
  ...ledgers: AnsweredGapEntry[][]
): AnsweredGapEntry[] {
  const map = new Map<string, AnsweredGapEntry>();
  for (const ledger of ledgers) {
    for (const entry of ledger) {
      const key = gapMatchKey(entry.gap, entry.garment_type);
      if (!map.has(key)) map.set(key, entry);
    }
  }
  return [...map.values()];
}

/**
 * Filter clarification questions that conversation / DB already answered.
 * Zero remaining → caller must proceed to search (emit nothing).
 */
export function filterQuestionsSatisfiedByConversation(params: {
  questions: FashionClarificationQuestion[];
  facts: FashionFactRow[];
  brief: {
    department_scope?: string | null;
    garments?: string[];
    stated_facts?: FashionStatedFacts;
  };
  profileHints?: IntakeProfileHints | null;
  resolvedGarments?: string[];
  /** Extra asked-and-answered ledger entries (e.g. clarification apply). */
  answeredLedger?: AnsweredGapEntry[];
  traceId?: string | null;
}): FashionClarificationQuestion[] {
  const ledger = mergeAnsweredLedgers(
    answeredGapsFromFacts(params.facts, params.profileHints),
    answeredGapsFromStatedFacts(
      params.brief.stated_facts ?? undefined,
    ),
    params.answeredLedger ?? [],
  );

  const hasDept =
    Boolean(params.brief.department_scope) ||
    isGapAnswered(ledger, "department");
  const garmentSatisfied =
    hasConcreteGarmentDirection(params.resolvedGarments ?? []) ||
    hasConcreteGarmentDirection(params.brief.garments ?? []) ||
    isGapAnswered(ledger, "garment");

  return params.questions.filter((q) => {
    if (q.gap === "department") return !hasDept;
    if (q.gap === "garment") return !garmentSatisfied;
    if (q.gap === "size") {
      const bucket = sizeBucketKey(q.garment_type) as SizeGarmentBucket | undefined;
      if (!bucket) {
        // No garment_type — satisfied if ANY dress/tops/… size is known via ledger.
        return !ledger.some((e) => e.gap === "size");
      }
      return !isGapAnswered(ledger, "size", bucket);
    }
    if (q.gap === "recipient" || q.gap === "person_name" || q.gap === "budget") {
      return !isGapAnswered(ledger, q.gap);
    }
    return true;
  });
}

/**
 * Tripwire: a proposed clarification whose gap matches stated_facts or the
 * ledger must never ship. Logs `reask_after_answer`.
 *
 * Soft by default — callers filter the question out and continue the turn.
 * Set `FASHION_INVARIANT_HARD_FAIL=1` only for CI / forensic runs that should
 * abort on LLM reasks (never in normal local/dev product usage).
 */
export function checkReaskAfterAnswer(params: {
  questions: FashionClarificationQuestion[];
  stated?: FashionStatedFacts | null;
  answeredLedger?: AnsweredGapEntry[];
  facts?: FashionFactRow[];
  profileHints?: IntakeProfileHints | null;
  personId?: string | null;
  traceId?: string | null;
}): boolean {
  const ledger = mergeAnsweredLedgers(
    answeredGapsFromFacts(params.facts ?? [], params.profileHints),
    answeredGapsFromStatedFacts(params.stated),
    params.answeredLedger ?? [],
  );

  let hit = false;
  for (const q of params.questions) {
    const answered =
      q.gap === "size"
        ? isGapAnswered(ledger, "size", q.garment_type) ||
          (!q.garment_type && ledger.some((e) => e.gap === "size"))
        : isGapAnswered(ledger, q.gap);

    if (!answered) continue;
    hit = true;

    const detail = {
      code: "reask_after_answer",
      gap: q.gap,
      garment_type: q.garment_type,
      person_id: params.personId ?? null,
      text: q.text.slice(0, 200),
      stated_facts: params.stated ?? null,
    };

    logAiChat("warn", "fashion_invariant_warning", detail);
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "invariant_warning",
      payload: detail,
    });

    if (process.env.FASHION_INVARIANT_HARD_FAIL === "1") {
      const err = new Error(
        `reask_after_answer: ${q.gap}${q.garment_type ? `:${q.garment_type}` : ""} — "${q.text.slice(0, 80)}"`,
      );
      (err as Error & { code?: string }).code = "reask_after_answer";
      throw err;
    }
  }
  return hit;
}

/** @deprecated Prefer checkReaskAfterAnswer + filterQuestionsSatisfiedByConversation. */
export function assertNoReaskAfterAnswer(params: {
  questions: FashionClarificationQuestion[];
  stated?: FashionStatedFacts | null;
  answeredLedger?: AnsweredGapEntry[];
  facts?: FashionFactRow[];
  profileHints?: IntakeProfileHints | null;
  personId?: string | null;
  traceId?: string | null;
}): FashionClarificationQuestion[] {
  checkReaskAfterAnswer(params);
  return filterQuestionsSatisfiedByConversation({
    questions: params.questions,
    facts: params.facts ?? [],
    brief: { stated_facts: params.stated ?? undefined },
    profileHints: params.profileHints,
    answeredLedger: params.answeredLedger,
    traceId: params.traceId,
  });
}

/**
 * Gaps answered this turn (stated_facts / clarification apply) must not
 * count toward the dodge counter — an answered question is not a dodge.
 */
export function suppressDeclinedForAnsweredGaps<T extends { gap: FashionClarificationGap; garment_type?: string }>(
  questions: T[],
  answeredLedger: AnsweredGapEntry[],
): T[] {
  return questions.filter(
    (q) => !isGapAnswered(answeredLedger, q.gap, q.garment_type),
  );
}
