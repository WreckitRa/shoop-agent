import { prisma } from "@/lib/ai-chat/db";
import { isSupabaseAuthUserId } from "../auth";
import { upsertFashionFact } from "../facts";
import { FashionLocalStore } from "../local/store";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { resolvePerson } from "../people";
import type {
  FashionClarificationQuestion,
  FashionIntakeQuestion,
  MessageFashionRouterMetaV1,
} from "../router/types";
import type { FashionFactRow, PersonRelation } from "../types";
import { bucketForIntakeField } from "./garment-size-fields";
import { parseDepartmentAnswer } from "./identity-gate";

type ApplyQuestion = {
  text: string;
  field?: FashionIntakeQuestion["field"] | FashionClarificationQuestion["field"];
  gap?: FashionClarificationQuestion["gap"];
  garment_type?: string;
  quick_options?: string[];
};

function asApplyQuestions(
  questions: FashionClarificationQuestion[] | FashionIntakeQuestion[],
): ApplyQuestion[] {
  return questions.map((q) => {
    if ("text" in q && "gap" in q) {
      return {
        text: q.text,
        field: q.field,
        gap: q.gap,
        garment_type: q.garment_type,
        quick_options: q.quick_options,
      };
    }
    return {
      text: q.question,
      field: q.field,
      quick_options: q.quick_options,
    };
  });
}

function extractAnswerForQuestion(
  userMessage: string,
  question: ApplyQuestion,
  allQuestions: ApplyQuestion[],
): string | null {
  const idx = userMessage.indexOf(question.text);
  if (idx < 0) return null;

  let tail = userMessage.slice(idx + question.text.length).trim();
  if (tail.startsWith(".")) tail = tail.slice(1).trim();

  for (const other of allQuestions) {
    if (other.text === question.text) continue;
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
    const quick = q.quick_options?.find(
      (o) => o.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    out[key] = quick ?? trimmed;
    return out;
  }

  return out;
}

/** @deprecated alias */
export function parseIntakeAnswersFromMessage(
  userMessage: string,
  questions: FashionIntakeQuestion[],
): Record<string, string> {
  return parseClarificationAnswersFromMessage(
    userMessage,
    asApplyQuestions(questions),
  );
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
      };
    }

    // Legacy run_intake metadata
    const legacy = router as MessageFashionRouterMetaV1 & {
      move?: string;
      intake?: { target_person_id: string; questions: FashionIntakeQuestion[] };
    };
    if (
      (legacy.move as string) === "run_intake" &&
      legacy.intake?.questions?.length
    ) {
      return {
        targetPersonId: legacy.intake.target_person_id,
        questions: asApplyQuestions(legacy.intake.questions),
      };
    }
  }
  return null;
}

/** @deprecated */
export async function loadPriorIntakeTurn(conversationId: string): Promise<{
  targetPersonId: string;
  questions: FashionIntakeQuestion[];
} | null> {
  const prior = await loadPriorClarificationTurn(conversationId);
  if (!prior?.targetPersonId) return null;
  const questions: FashionIntakeQuestion[] = prior.questions
    .filter((q) => q.field)
    .map((q) => ({
      field: q.field as FashionIntakeQuestion["field"],
      question: q.text,
      quick_options: q.quick_options,
    }));
  if (!questions.length) return null;
  return { targetPersonId: prior.targetPersonId, questions };
}

export async function applyClarificationReplyFromMessage(params: {
  userId: string;
  conversationId: string;
  userMessage: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<{ facts: FashionFactRow[]; personId: string | null }> {
  const prior = await loadPriorClarificationTurn(params.conversationId);
  if (!prior) return { facts: [], personId: null };

  const answers = parseClarificationAnswersFromMessage(
    params.userMessage,
    prior.questions,
  );
  if (!Object.keys(answers).length) {
    return { facts: [], personId: prior.targetPersonId };
  }

  let personId = prior.targetPersonId;
  const written: FashionFactRow[] = [];

  // Register new person when name is provided.
  const nameAnswer =
    answers.person_name ??
    answers[
      prior.questions.find((q) => q.gap === "person_name")?.text ?? ""
    ];
  if (nameAnswer?.trim() && !personId) {
    const relation = inferRelationFromText(
      `${params.userMessage} ${nameAnswer}`,
    );
    if (isSupabaseAuthUserId(params.userId)) {
      const person = await resolvePerson({
        userId: params.userId,
        relation,
        name: nameAnswer.trim(),
      });
      personId = person.id;
    } else if (params.guestSnapshot) {
      const store = new FashionLocalStore(params.guestSnapshot);
      const person = store.resolvePerson({
        userId: params.userId,
        relation,
        name: nameAnswer.trim(),
      });
      personId = person.id;
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
      return { facts: [], personId: null };
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
      const bucket = sizeField
        ? bucketForIntakeField(sizeField)
        : (q?.garment_type as "tops" | "bottoms" | "shoes" | "dresses" | undefined) ??
          "tops";
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
    if (!q.field) continue;
    const raw = answers[q.field] ?? answers[q.text];
    if (!raw) continue;
    if (written.some((f) => {
      if (q.field === "gender_presentation") return f.fact_type === "gender_presentation";
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
    const fact = await writeFact(q.field, raw);
    if (fact) written.push(fact);
  }

  return { facts: written, personId };
}

/** @deprecated */
export async function applyIntakeReplyFromMessage(params: {
  userId: string;
  conversationId: string;
  userMessage: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<{ facts: FashionFactRow[]; personId: string | null }> {
  return applyClarificationReplyFromMessage(params);
}
