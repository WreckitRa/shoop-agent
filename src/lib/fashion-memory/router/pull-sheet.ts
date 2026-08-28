import {
  asNormalizedOptions,
  formatClarificationAnswerDisplay,
} from "./clarification-defaults";
import {
  isConsultQuestion,
  isYouDecideOption,
  YOU_DECIDE_LABEL,
  YOU_DECIDE_OPTION_ID,
} from "./consultation";
import type {
  FashionClarificationAnswer,
  FashionClarificationDisplay,
  FashionClarificationGap,
  FashionClarificationQuestion,
  FashionSearchBrief,
} from "./types";

export const STEPPER_MIN = 1;
export const STEPPER_MAX = 8;
export const PULL_SHEET_JOIN = " | ";

/** UI Done line: "slots: Tee, Shorts | depth: 3 | preference_anchor: Keep it me" */
export function formatPullSheetPart(
  gap: FashionClarificationGap | string | undefined,
  display: string,
): string {
  const g = (gap ?? "answer").trim() || "answer";
  return `${g}: ${display}`;
}

export function defaultDisplayForGap(
  gap: FashionClarificationGap,
): FashionClarificationDisplay {
  switch (gap) {
    case "slots":
      return "checklist";
    case "depth":
      return "stepper";
    case "budget":
      return "range";
    case "person_name":
      return "text";
    default:
      return "chips";
  }
}

export function optionHasPreview(
  question: Pick<FashionClarificationQuestion, "quick_options">,
): boolean {
  return asNormalizedOptions(question.quick_options).some((o) =>
    Boolean(o.previewQuery?.trim()),
  );
}

export function resolveQuestionDisplay(
  question: FashionClarificationQuestion,
): FashionClarificationDisplay {
  if (question.display) return question.display;
  if (question.gap === "occasion" && optionHasPreview(question)) {
    return "visual";
  }
  if (
    (question.gap === "style_lane" ||
      question.gap === "color" ||
      question.gap === "direction") &&
    optionHasPreview(question)
  ) {
    return "visual";
  }
  return defaultDisplayForGap(question.gap);
}

export function preselectedOptionIds(
  question: FashionClarificationQuestion,
): string[] {
  return asNormalizedOptions(question.quick_options)
    .filter((o) => o.preselected && !isYouDecideOption(o))
    .map((o) => o.id);
}

export function seedStepperValue(question: FashionClarificationQuestion): number {
  for (const option of asNormalizedOptions(question.quick_options)) {
    if (isYouDecideOption(option)) continue;
    const match = option.label.match(/\d+/);
    if (!match) continue;
    const n = Number(match[0]);
    if (!Number.isFinite(n)) continue;
    return clampStepper(n);
  }
  return 3;
}

export function clampStepper(n: number): number {
  if (!Number.isFinite(n)) return STEPPER_MIN;
  return Math.min(STEPPER_MAX, Math.max(STEPPER_MIN, Math.round(n)));
}

export function stepperUnitLabel(question: FashionClarificationQuestion): string {
  return /\blooks?\b/i.test(question.text) ? "looks" : "options";
}

export function answerHasContent(
  answer: FashionClarificationAnswer | undefined,
  options?: FashionClarificationQuestion["quick_options"],
): boolean {
  return Boolean(formatClarificationAnswerDisplay(answer, options));
}

export function youDecideAnswer(): FashionClarificationAnswer {
  return { selected: [YOU_DECIDE_OPTION_ID] };
}

export function clarificationAnswersAreTaps(
  answers?: Record<string, { selected?: string[]; customText?: string }> | null,
): boolean {
  if (!answers) return false;
  const values = Object.values(answers);
  if (!values.length) return false;
  return values.every(
    (a) => (a.selected?.length ?? 0) > 0 && !a.customText?.trim(),
  );
}

export function formatPullSheetMessage(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
  rideAlong?: FashionClarificationQuestion | null,
): string {
  const parts: string[] = [];
  for (const question of questions) {
    const display = formatClarificationAnswerDisplay(
      answers[question.text],
      question.quick_options,
    );
    if (display) {
      parts.push(formatPullSheetPart(question.gap, display));
    }
  }
  if (rideAlong) {
    const display = formatClarificationAnswerDisplay(
      answers[rideAlong.text],
      rideAlong.quick_options,
    );
    if (display) {
      parts.push(formatPullSheetPart(rideAlong.gap, display));
    }
  }
  return parts.join(PULL_SHEET_JOIN);
}

export function blockingQuestionsUnanswered(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
): FashionClarificationQuestion[] {
  return questions.filter(
    (q) =>
      !isConsultQuestion(q) && !answerHasContent(answers[q.text], q.quick_options),
  );
}

export function canEscapePullSheet(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
): boolean {
  return blockingQuestionsUnanswered(questions, answers).length === 0;
}

export function canSubmitPullSheet(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
): boolean {
  if (blockingQuestionsUnanswered(questions, answers).length) return false;
  return questions
    .filter((q) => q.gap === "slots")
    .every((q) => answerHasContent(answers[q.text], q.quick_options));
}

export function fillUnansweredConsults(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
): Record<string, FashionClarificationAnswer> {
  const next = { ...answers };
  for (const question of questions) {
    if (!isConsultQuestion(question)) continue;
    if (answerHasContent(next[question.text], question.quick_options)) continue;
    next[question.text] = youDecideAnswer();
  }
  return next;
}

export function buildDoneAnswers(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
): Record<string, FashionClarificationAnswer> {
  return fillUnansweredConsults(questions, answers);
}

export function buildEscapeAnswers(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
): Record<string, FashionClarificationAnswer> | null {
  if (!canEscapePullSheet(questions, answers)) return null;
  const next = { ...answers };
  for (const question of questions) {
    if (question.gap === "slots") {
      next[question.text] = { selected: preselectedOptionIds(question) };
      continue;
    }
    if (!isConsultQuestion(question)) continue;
    if (answerHasContent(next[question.text], question.quick_options)) continue;
    next[question.text] = youDecideAnswer();
  }
  return next;
}

export function formatCountLabel(
  n: number,
  singular: string,
  plural: string,
): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}

export function formatPullSheetRecap(
  brief: Pick<
    FashionSearchBrief,
    "garments" | "consultation" | "preference_anchor" | "depth" | "request_type"
  >,
): string | null {
  const garments = (brief.garments ?? [])
    .map((g) => g.trim())
    .filter(Boolean);
  const confirmed = (brief.consultation?.confirmed ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const bits: string[] = [];
  if (garments.length) bits.push(`Pulled: ${garments.join(", ")}`);
  const garmentSet = new Set(garments.map((g) => g.toLowerCase()));
  for (const line of confirmed) {
    if (garmentSet.has(line.toLowerCase())) continue;
    bits.push(line);
  }
  if (!confirmed.length) {
    const depth =
      brief.depth?.looks_wanted ?? brief.depth?.options_per_item;
    if (depth) {
      const singular =
        brief.request_type === "single_item" ? "option" : "look";
      const plural =
        brief.request_type === "single_item" ? "options" : "looks";
      bits.push(formatCountLabel(depth, singular, plural));
    }
    if (brief.preference_anchor === "keep") bits.push("kept it you");
    else if (brief.preference_anchor === "push") bits.push("pushed it");
    else if (brief.preference_anchor === "explore") bits.push("something new");
  }
  return bits.length ? bits.join(" · ") : null;
}

export { YOU_DECIDE_LABEL };
