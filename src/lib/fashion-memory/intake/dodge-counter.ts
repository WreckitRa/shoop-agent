import { prisma } from "@/lib/ai-chat/db";
import type {
  FashionClarificationGap,
  FashionClarificationQuestion,
  MessageFashionRouterMetaV1,
} from "../router/types";

export type DeclinedGapKey = {
  gap: FashionClarificationGap;
  person_id: string;
  garment_type?: string;
};

function gapKey(entry: DeclinedGapKey): string {
  return `${entry.person_id}|${entry.gap}|${entry.garment_type ?? ""}`;
}

/** Count how many times this (gap, person[, garment]) was asked since last search. */
export async function countGapAsksSinceReset(params: {
  conversationId: string;
  gap: FashionClarificationGap;
  personId: string;
  garmentType?: string;
}): Promise<number> {
  const rows = await prisma.message.findMany({
    where: { conversationId: params.conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 32,
    select: { metadata: true },
  });

  let count = 0;
  const target = gapKey({
    gap: params.gap,
    person_id: params.personId,
    garment_type: params.garmentType,
  });

  for (const row of rows) {
    const meta = row.metadata as {
      fashionRouter?: MessageFashionRouterMetaV1;
      fashionSearchPlan?: unknown;
    } | null;
    if (meta?.fashionSearchPlan) break;
    const router = meta?.fashionRouter;
    if (!router) continue;
    if (router.move === "ready_to_search") break;

    if (router.move === "ask_clarification") {
      const questions = router.questions ?? [];
      const personId = router.target_person_id ?? params.personId;
      for (const q of questions) {
        if (
          gapKey({
            gap: q.gap,
            person_id: personId,
            garment_type: q.garment_type,
          }) === target
        ) {
          count += 1;
        }
      }
      // Legacy flat missing[]
      if (!questions.length && router.missing?.includes(params.gap)) {
        count += 1;
      }
    }
  }
  return count;
}

export async function loadDeclinedGaps(
  conversationId: string,
): Promise<DeclinedGapKey[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 32,
    select: { metadata: true },
  });

  const declined = new Map<string, DeclinedGapKey>();
  for (const row of rows) {
    const meta = row.metadata as {
      fashionRouter?: MessageFashionRouterMetaV1;
      fashionSearchPlan?: unknown;
    } | null;
    if (meta?.fashionSearchPlan) break;
    const router = meta?.fashionRouter;
    if (!router) continue;
    if (router.move === "ready_to_search") break;
    for (const d of router.declined_gaps ?? []) {
      declined.set(gapKey(d), d);
    }
  }
  return [...declined.values()];
}

export function isGapDeclined(
  declined: DeclinedGapKey[],
  entry: DeclinedGapKey,
): boolean {
  return declined.some((d) => gapKey(d) === gapKey(entry));
}

/** Gaps asked at least once since last search (for template dedup). */
export async function listAskedGapsSinceReset(params: {
  conversationId: string;
  personId: string;
}): Promise<Array<{ gap: FashionClarificationGap; garment_type?: string }>> {
  const rows = await prisma.message.findMany({
    where: { conversationId: params.conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 32,
    select: { metadata: true },
  });

  const asked = new Map<
    string,
    { gap: FashionClarificationGap; garment_type?: string }
  >();

  for (const row of rows) {
    const meta = row.metadata as {
      fashionRouter?: MessageFashionRouterMetaV1;
      fashionSearchPlan?: unknown;
    } | null;
    if (meta?.fashionSearchPlan) break;
    const router = meta?.fashionRouter;
    if (!router) continue;
    if (router.move === "ready_to_search") break;

    if (router.move === "ask_clarification") {
      const personId = router.target_person_id ?? params.personId;
      for (const q of router.questions ?? []) {
        const entry = {
          gap: q.gap,
          garment_type: q.garment_type,
        };
        asked.set(
          gapKey({
            gap: q.gap,
            person_id: personId,
            garment_type: q.garment_type,
          }),
          entry,
        );
      }
    }
  }

  return [...asked.values()];
}

/**
 * After asking a gap, if this is the 2nd ask without a usable answer on the
 * next turn, mark declined. Call when building the next clarification or
 * when proceeding to search with remaining gaps.
 */
export async function gapsToDeclineAfterDodge(params: {
  conversationId: string;
  personId: string;
  questions: FashionClarificationQuestion[];
  /** True when the latest user message did not answer this gap. */
  unansweredGaps: FashionClarificationGap[];
}): Promise<DeclinedGapKey[]> {
  const out: DeclinedGapKey[] = [];
  for (const q of params.questions) {
    if (!params.unansweredGaps.includes(q.gap)) continue;
    const asks = await countGapAsksSinceReset({
      conversationId: params.conversationId,
      gap: q.gap,
      personId: params.personId,
      garmentType: q.garment_type,
    });
    // asks already includes prior turns; if prior ask count >= 2, decline.
    if (asks >= 2) {
      out.push({
        gap: q.gap,
        person_id: params.personId,
        garment_type: q.garment_type,
      });
    }
  }
  return out;
}

export function filterQuestionsByDeclined(
  questions: FashionClarificationQuestion[],
  personId: string,
  declined: DeclinedGapKey[],
): FashionClarificationQuestion[] {
  return questions.filter(
    (q) =>
      !isGapDeclined(declined, {
        gap: q.gap,
        person_id: personId,
        garment_type: q.garment_type,
      }),
  );
}
