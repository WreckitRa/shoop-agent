import type {
  FashionClarificationGap,
  FashionClarificationOption,
  FashionClarificationQuestion,
  FashionSearchBrief,
} from "./types";
import type { FashionPendingBriefMetaV1 } from "./types";
import { asNormalizedOptions } from "./clarification-defaults";

export const YOU_DECIDE_LABEL = "You decide";
export const YOU_DECIDE_OPTION_ID = "you_decide";
export const JUST_SHOW_ME_LABEL = "Just show me";

export const CONSULTATION_BUDGET_SPENT_NOTE =
  "CONSULTATION BUDGET SPENT — call ready_to_search and list assumptions.";

export const BLOCKING_GAPS: readonly FashionClarificationGap[] = [
  "garment",
  "recipient",
  "person_name",
  "department",
  "size",
  "occasion",
];

export const CONSULT_GAPS: readonly FashionClarificationGap[] = [
  "depth",
  "preference_anchor",
  "budget",
  "style_lane",
  "color",
  "brand",
  "fit",
  "formality",
  "direction",
  "slots",
];

export function defaultKindForGap(
  gap: FashionClarificationGap,
): "blocking" | "consult" {
  return (BLOCKING_GAPS as readonly string[]).includes(gap)
    ? "blocking"
    : "consult";
}

export function isConsultQuestion(
  question: Pick<FashionClarificationQuestion, "gap" | "kind">,
): boolean {
  if (question.kind === "consult") return true;
  if (question.kind === "blocking") return false;
  return defaultKindForGap(question.gap) === "consult";
}

export function questionsHaveConsult(
  questions: Array<Pick<FashionClarificationQuestion, "gap" | "kind">>,
): boolean {
  return questions.some(isConsultQuestion);
}

export function isYouDecideOption(
  option: string | FashionClarificationOption,
): boolean {
  if (typeof option === "string") {
    return option.trim().toLowerCase() === YOU_DECIDE_LABEL.toLowerCase();
  }
  return (
    option.id === YOU_DECIDE_OPTION_ID ||
    option.label.trim().toLowerCase() === YOU_DECIDE_LABEL.toLowerCase()
  );
}

export function ensureYouDecideOption(
  question: FashionClarificationQuestion,
): FashionClarificationQuestion {
  if (!isConsultQuestion(question)) return question;
  const existing = asNormalizedOptions(question.quick_options);
  if (existing.some(isYouDecideOption)) return question;
  return {
    ...question,
    quick_options: [
      ...existing,
      { id: YOU_DECIDE_OPTION_ID, label: YOU_DECIDE_LABEL },
    ],
  };
}

export function garmentsKey(garments: string[] | undefined): string {
  return [...(garments ?? [])]
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function nextConsultRoundsUsed(params: {
  pending: FashionPendingBriefMetaV1 | null;
  brief: FashionSearchBrief | undefined;
  questions: Array<Pick<FashionClarificationQuestion, "gap" | "kind">>;
}): 0 | 1 | 2 {
  const prev = params.pending?.consult_rounds_used ?? 0;
  if (!questionsHaveConsult(params.questions)) {
    return prev === 1 || prev === 2 ? prev : 0;
  }
  const pending = params.pending;
  const brief = params.brief;
  if (
    !pending ||
    !brief ||
    pending.recipientPersonId !== brief.recipient_person_id ||
    garmentsKey(pending.brief.garments) !== garmentsKey(brief.garments)
  ) {
    return 1;
  }
  return prev >= 1 ? 2 : 1;
}

export function isEscapeOrYouDecideMessage(
  text: string,
  escapeChip?: string | null,
): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t === YOU_DECIDE_LABEL.toLowerCase()) return true;
  if (t === JUST_SHOW_ME_LABEL.toLowerCase()) return true;
  if (escapeChip && t === escapeChip.trim().toLowerCase()) return true;
  return false;
}

export function consultGapsFromAnsweredQuestions(params: {
  questions: FashionClarificationQuestion[];
  answeredTexts: Set<string>;
  userMessage: string;
  escapeChip?: string | null;
}): FashionClarificationGap[] {
  const escape = isEscapeOrYouDecideMessage(
    params.userMessage,
    params.escapeChip,
  );
  const gaps: FashionClarificationGap[] = [];
  for (const q of params.questions) {
    if (!isConsultQuestion(q)) continue;
    if (escape || params.answeredTexts.has(q.text)) {
      gaps.push(q.gap);
    }
  }
  return gaps;
}
