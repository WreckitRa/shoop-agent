import { parseBudgetRaiseAnswer } from "../budget/budget-raise-ask";
import { prisma } from "@/lib/ai-chat/db";
import { isSupabaseAuthUserId } from "../auth";
import { upsertFashionFact } from "../facts";
import { FashionLocalStore } from "../local/store";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { resolvePerson } from "../people";
import {
  formatClarificationAnswerDisplay,
  optionLabels,
} from "../router/clarification-defaults";
import type {
  FashionClarificationAnswer,
  FashionClarificationOption,
  FashionClarificationQuestion,
  MessageFashionRouterMetaV1,
} from "../router/types";
import type { FashionFactRow, PersonRelation } from "../types";
import { normalizeGarmentClarificationAnswer } from "./garment-answer";
import { bucketForIntakeField } from "./garment-size-fields";
import { parseDepartmentAnswer } from "./identity-gate";

type ApplyQuestion = {
  text: string;
  field?: FashionClarificationQuestion["field"];
  gap?: FashionClarificationQuestion["gap"];
  garment_type?: string;
  quick_options?: Array<string | FashionClarificationOption>;
  allow_multiple?: boolean;
};

function asApplyQuestions(
  questions: FashionClarificationQuestion[],
): ApplyQuestion[] {
  return questions.map((q) => ({
    text: q.text,
    field: q.field,
    gap: q.gap,
    garment_type: q.garment_type,
    quick_options: q.quick_options,
    allow_multiple: q.allow_multiple,
  }));
}

/** Flatten structured answers into field|gap|text → display string. */
export function flattenClarificationAnswers(
  answers: Record<string, FashionClarificationAnswer> | undefined,
  questions: ApplyQuestion[],
): Record<string, string> {
  if (!answers) return {};
  const out: Record<string, string> = {};
  for (const q of questions) {
    const raw = answers[q.text];
    if (raw == null) continue;
    let display = formatClarificationAnswerDisplay(raw, q.quick_options);
    if (!display) continue;
    // Exclusive gaps: if multi somehow arrives, take the first chip/label.
    const exclusive =
      q.gap === "size" ||
      q.gap === "department" ||
      q.gap === "recipient" ||
      q.gap === "budget" ||
      q.gap === "person_name" ||
      (q.gap === "garment" && !q.allow_multiple);
    if (exclusive && display.includes(",")) {
      display = display.split(",")[0]!.trim();
    }
    const sizeBucketFromText = (() => {
      if (q.gap !== "size") return null;
      const t = q.text.toLowerCase();
      if (/\b(shoe|shoes|sneaker|boot)\b/.test(t)) return "shoes";
      if (/\b(dress|dresses|gown|skirt)\b/.test(t)) return "dresses";
      if (/\b(bottom|waist|pant|trouser|jean)\b/.test(t)) return "bottoms";
      if (/\b(top|shirt|tee|blouse|sweater|jacket|blazer)\b/.test(t)) {
        return "tops";
      }
      return null;
    })();
    const sizeBucket =
      q.gap === "size"
        ? q.field?.startsWith("size_")
          ? q.field.slice("size_".length)
          : q.garment_type === "tops" ||
              q.garment_type === "bottoms" ||
              q.garment_type === "shoes" ||
              q.garment_type === "dresses"
            ? q.garment_type
            : sizeBucketFromText
        : null;
    const key =
      sizeBucket != null
        ? `size_${sizeBucket}`
        : (q.field ?? q.gap ?? q.text);
    out[key] = display;
    out[q.text] = display;
  }
  return out;
}

/**
 * Normalize question text for echo matching — users often paste a near-copy
 * ("What's Rima's dress size?" vs "What's Rima's typical dress size?").
 */
function normalizeQuestionEcho(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\b(typical|usual|usually|approx|approximately)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findEchoSpan(
  userMessage: string,
  questionText: string,
): { start: number; end: number } | null {
  const exact = userMessage.indexOf(questionText);
  if (exact >= 0) {
    return { start: exact, end: exact + questionText.length };
  }

  // Fuzzy: locate the normalized echo inside the normalized message, then
  // map back by scanning word-aligned substrings (handles "typical" drops).
  const normQ = normalizeQuestionEcho(questionText);
  if (normQ.length < 8) return null;
  const normMsg = normalizeQuestionEcho(userMessage);
  const normIdx = normMsg.indexOf(normQ);
  if (normIdx < 0) return null;

  // Reconstruct approximate span: take from the first distinctive token.
  const anchor = questionText
    .replace(/[?？].*$/, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(what|whats|what's|which|the|for|and|does|do|you|your)$/i.test(w))
    .slice(-3)
    .join(" ");
  if (anchor.length >= 4) {
    const anchorIdx = userMessage.toLowerCase().indexOf(anchor.toLowerCase());
    if (anchorIdx >= 0) {
      const qMark = userMessage.indexOf("?", anchorIdx);
      const end = qMark >= 0 ? qMark + 1 : anchorIdx + anchor.length;
      return { start: Math.max(0, anchorIdx - 24), end };
    }
  }

  // Fallback: treat "?" after a size/department cue as the echo boundary.
  const cue =
    /\b(dress size|shoe size|tops?|bottoms?|size|section|department)\b/i.exec(
      userMessage,
    );
  if (cue && cue.index != null) {
    const qMark = userMessage.indexOf("?", cue.index);
    if (qMark >= 0) return { start: cue.index, end: qMark + 1 };
  }
  return null;
}

function extractAnswerForQuestion(
  userMessage: string,
  question: ApplyQuestion,
  allQuestions: ApplyQuestion[],
): string | null {
  const span = findEchoSpan(userMessage, question.text);
  if (!span) return null;

  let tail = userMessage.slice(span.end).trim();
  if (tail.startsWith(".")) tail = tail.slice(1).trim();

  for (const other of allQuestions) {
    if (other.text === question.text) continue;
    const otherSpan = findEchoSpan(tail, other.text);
    if (otherSpan && otherSpan.start > 0) {
      tail = tail.slice(0, otherSpan.start).trim();
      break;
    }
    const otherIdx = tail.indexOf(other.text);
    if (otherIdx > 0) {
      tail = tail.slice(0, otherIdx).trim();
      break;
    }
  }

  return tail.replace(/\.\s*$/, "").trim() || null;
}

export function parseClarificationAnswersFromMessage(
  userMessage: string,
  questions: ApplyQuestion[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const key = q.field ?? q.gap ?? q.text;
    const answer = extractAnswerForQuestion(userMessage, q, questions);
    if (answer) out[key] = answer;
  }
  if (Object.keys(out).length) return out;

  const trimmed = userMessage.trim();
  if (!trimmed) return out;

  if (questions.length === 1) {
    const q = questions[0]!;
    const key = q.field ?? q.gap ?? q.text;
    const labels = optionLabels(q.quick_options);
    const quick = labels.find(
      (o) => o.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    out[key] = quick ?? trimmed;
    return out;
  }

  return out;
}

function parseSizeValue(raw: string): {
  system: "alpha" | "eu" | "us" | "uk";
  value: string | number;
} {
  const t = raw.trim().toUpperCase();
  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL)$/.test(t)) {
    return { system: "alpha", value: t };
  }
  const numeric = Number(raw.trim());
  if (Number.isFinite(numeric)) {
    if (numeric >= 35 && numeric <= 50) return { system: "eu", value: numeric };
    if (numeric >= 5 && numeric <= 15) return { system: "us", value: numeric };
    return { system: "us", value: numeric };
  }
  return { system: "alpha", value: raw.trim() };
}

function parseFitValue(raw: string): "slim" | "regular" | "relaxed" | "oversized" | null {
  const t = raw.trim().toLowerCase();
  if (t === "slim") return "slim";
  if (t === "regular") return "regular";
  if (t === "relaxed") return "relaxed";
  if (t === "oversized") return "oversized";
  return null;
}

function inferRelationFromText(text: string): PersonRelation {
  const t = text.toLowerCase();
  if (/\b(colleague|coworker|co-worker)\b/.test(t)) return "friend";
  if (/\bfriend\b/.test(t)) return "friend";
  if (/\bmother|mom\b/.test(t)) return "mother";
  if (/\bfather|dad\b/.test(t)) return "father";
  if (/\bwife\b/.test(t)) return "wife";
  if (/\bhusband\b/.test(t)) return "husband";
  if (/\bsister\b/.test(t)) return "sister";
  if (/\bbrother\b/.test(t)) return "brother";
  if (/\bson\b/.test(t)) return "son";
  if (/\bdaughter\b/.test(t)) return "daughter";
  return "friend";
}

export async function loadPriorClarificationTurn(conversationId: string): Promise<{
  targetPersonId: string | null;
  questions: ApplyQuestion[];
  answers?: Record<string, FashionClarificationAnswer>;
} | null> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 16,
    select: { metadata: true },
  });
  for (const row of rows) {
    const meta = row?.metadata as { fashionRouter?: MessageFashionRouterMetaV1 } | null;
    const router = meta?.fashionRouter;
    if (!router) continue;

    if (router.move === "ask_clarification" && router.questions?.length) {
      return {
        targetPersonId: router.target_person_id ?? null,
        questions: asApplyQuestions(router.questions),
        answers: router.answers,
      };
    }
  }
  return null;
}

export async function applyClarificationReplyFromMessage(params: {
  userId: string;
  conversationId: string;
  userMessage: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<{
  facts: FashionFactRow[];
  personId: string | null;
  /** User chose continue-anyway on a budget-raise ask — decline re-prompt. */
  declineBudgetRaise?: boolean;
  /** Parsed raised budget max when a dollar chip / free-text amount was answered. */
  raisedBudgetMax?: number;
  /** Concrete garments resolved from a prior gap:"garment" clarification. */
  resolvedGarments?: string[];
}> {
  const prior = await loadPriorClarificationTurn(params.conversationId);
  if (!prior) return { facts: [], personId: null };

  const structured = flattenClarificationAnswers(prior.answers, prior.questions);
  const echoed = parseClarificationAnswersFromMessage(
    params.userMessage,
    prior.questions,
  );
  const answers = Object.keys(structured).length ? structured : echoed;

  const garmentQuestion = prior.questions.find((q) => q.gap === "garment");
  const garmentRaw =
    answers.garment ??
    (garmentQuestion
      ? answers[garmentQuestion.field ?? ""] ?? answers[garmentQuestion.text]
      : undefined);
  const garmentOptionLabels = optionLabels(garmentQuestion?.quick_options);
  const resolvedGarments =
    garmentRaw != null
      ? normalizeGarmentClarificationAnswer(garmentRaw, garmentOptionLabels)
      : prior.questions.some((q) => q.gap === "garment")
        ? normalizeGarmentClarificationAnswer(
            params.userMessage,
            garmentOptionLabels,
          )
        : [];

  if (!Object.keys(answers).length && !resolvedGarments.length) {
    return { facts: [], personId: prior.targetPersonId };
  }

  // Garment-only reply (chip / free text) — still return resolved garments even
  // when no durable size/department facts are written below.
  if (!Object.keys(answers).length && resolvedGarments.length) {
    return {
      facts: [],
      personId: prior.targetPersonId,
      resolvedGarments,
    };
  }

  let personId = prior.targetPersonId;
  const written: FashionFactRow[] = [];
  let declineBudgetRaise = false;
  let raisedBudgetMax: number | undefined;

  // Register / name a person. Relation from the ask beats a bare name tap
  // (son Gabriel ≠ brother Gabriel). Prefer updating the clarification target.
  const nameAnswerRaw =
    answers.person_name ??
    answers[
      prior.questions.find((q) => q.gap === "person_name")?.text ?? ""
    ];
  const nameAnswer =
    nameAnswerRaw?.trim() &&
    nameAnswerRaw.trim().toLowerCase() !== "skip"
      ? nameAnswerRaw.trim()
      : null;

  if (nameAnswer && personId) {
    if (isSupabaseAuthUserId(params.userId)) {
      const { updatePersonName } = await import("../people");
      await updatePersonName({
        userId: params.userId,
        personId,
        name: nameAnswer,
      });
    } else if (params.guestSnapshot) {
      const store = new FashionLocalStore(params.guestSnapshot);
      store.updatePersonName({
        userId: params.userId,
        personId,
        name: nameAnswer,
      });
    }
  } else if (nameAnswer && !personId) {
    const relation = inferRelationFromText(params.userMessage);
    // Bare name replies ("Gabriel") carry no relation — refuse name-only merge.
    if (relation !== "friend" || /\b(friend|colleague)\b/i.test(params.userMessage)) {
      if (isSupabaseAuthUserId(params.userId)) {
        const person = await resolvePerson({
          userId: params.userId,
          relation,
          name: nameAnswer,
        });
        personId = person.id;
      } else if (params.guestSnapshot) {
        const store = new FashionLocalStore(params.guestSnapshot);
        const person = store.resolvePerson({
          userId: params.userId,
          relation,
          name: nameAnswer,
        });
        personId = person.id;
      }
    }
  }

  if (!personId) {
    // Department/size answers need a person — default to self.
    if (isSupabaseAuthUserId(params.userId)) {
      personId = (await resolvePerson({ userId: params.userId, relation: "self" }))
        .id;
    } else if (params.guestSnapshot) {
      const store = new FashionLocalStore(params.guestSnapshot);
      personId = store.resolvePerson({
        userId: params.userId,
        relation: "self",
      }).id;
    } else {
      return {
        facts: [],
        personId: null,
        ...(resolvedGarments.length ? { resolvedGarments } : {}),
      };
    }
  }

  const writeFact = async (
    field: string,
    raw: string,
  ): Promise<FashionFactRow | null> => {
    if (field === "gender_presentation" || field === "department") {
      const presentation = parseDepartmentAnswer(raw);
      if (!presentation) return null;
      if (isSupabaseAuthUserId(params.userId)) {
        return upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "gender_presentation",
          value: { presentation },
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      if (params.guestSnapshot) {
        const store = new FashionLocalStore(params.guestSnapshot);
        return store.upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "gender_presentation",
          value: { presentation },
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      return null;
    }
    if (field === "fit_preference") {
      const fit = parseFitValue(raw);
      if (!fit) return null;
      if (isSupabaseAuthUserId(params.userId)) {
        return upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "fit",
          value: { fit },
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      if (params.guestSnapshot) {
        const store = new FashionLocalStore(params.guestSnapshot);
        return store.upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "fit",
          value: { fit },
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      return null;
    }
    if (field.startsWith("size_") || field === "size") {
      const sizeField = field.startsWith("size_")
        ? (field as "size_tops" | "size_bottoms" | "size_shoes" | "size_dresses")
        : null;
      const q = prior.questions.find(
        (qq) =>
          qq.field === field ||
          (field === "size" && qq.gap === "size") ||
          qq.text === field,
      );
      const bucketFromGarment = (() => {
        const gt = q?.garment_type?.trim().toLowerCase();
        if (
          gt === "tops" ||
          gt === "bottoms" ||
          gt === "shoes" ||
          gt === "dresses"
        ) {
          return gt;
        }
        return null;
      })();
      const bucketFromText = (() => {
        const t = (q?.text ?? "").toLowerCase();
        if (/\b(shoe|shoes|sneaker|boot)\b/.test(t)) return "shoes" as const;
        if (/\b(dress|dresses|gown|skirt)\b/.test(t)) return "dresses" as const;
        if (/\b(bottom|waist|pant|trouser|jean)\b/.test(t)) {
          return "bottoms" as const;
        }
        if (/\b(top|shirt|tee|blouse|sweater|jacket|blazer)\b/.test(t)) {
          return "tops" as const;
        }
        return null;
      })();
      const bucket = sizeField
        ? bucketForIntakeField(sizeField)
        : (bucketFromGarment ?? bucketFromText ?? "tops");
      const parsed = parseSizeValue(raw);
      if (isSupabaseAuthUserId(params.userId)) {
        return upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "size",
          garmentType: bucket,
          value: parsed,
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      if (params.guestSnapshot) {
        const store = new FashionLocalStore(params.guestSnapshot);
        return store.upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "size",
          garmentType: bucket,
          value: parsed,
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      return null;
    }
    if (field === "budget_max" || field === "budget") {
      const parsed = parseBudgetRaiseAnswer(raw);
      if (parsed.kind === "continue") {
        declineBudgetRaise = true;
        return null;
      }
      if (parsed.kind !== "raise") return null;
      raisedBudgetMax = parsed.max;
      const band = {
        min: null as number | null,
        max: parsed.max,
        currency: "USD",
      };
      if (isSupabaseAuthUserId(params.userId)) {
        return upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "budget_band",
          value: band,
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      if (params.guestSnapshot) {
        const store = new FashionLocalStore(params.guestSnapshot);
        return store.upsertFashionFact({
          userId: params.userId,
          personId: personId!,
          factType: "budget_band",
          value: band,
          sourceQuote: params.userMessage.slice(0, 500),
        });
      }
      return null;
    }
    return null;
  };

  for (const [key, raw] of Object.entries(answers)) {
    if (key === "person_name" || key === "recipient" || key === "garment" || key === "occasion") {
      continue;
    }
    const fact = await writeFact(key, raw);
    if (fact) written.push(fact);
  }

  // Also map by question field when answers keyed by question text
  for (const q of prior.questions) {
    if (!q.field && q.gap !== "budget") continue;
    const field = q.field ?? (q.gap === "budget" ? "budget_max" : undefined);
    if (!field) continue;
    const raw = answers[field] ?? answers[q.gap ?? ""] ?? answers[q.text];
    if (!raw) continue;
    if (written.some((f) => {
      if (q.field === "gender_presentation") return f.fact_type === "gender_presentation";
      if (field === "budget_max" || q.gap === "budget") return f.fact_type === "budget_band";
      if (q.field?.startsWith("size_")) {
        return (
          f.fact_type === "size" &&
          f.garment_type ===
            bucketForIntakeField(
              q.field as "size_tops" | "size_bottoms" | "size_shoes" | "size_dresses",
            )
        );
      }
      return false;
    })) {
      continue;
    }
    const fact = await writeFact(field, raw);
    if (fact) written.push(fact);
  }

  return {
    facts: written,
    personId,
    ...(declineBudgetRaise ? { declineBudgetRaise: true } : {}),
    ...(raisedBudgetMax != null ? { raisedBudgetMax } : {}),
    ...(resolvedGarments.length ? { resolvedGarments } : {}),
  };
}
