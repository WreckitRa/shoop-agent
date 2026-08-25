"use client";

import { memo, useMemo, useState } from "react";
import { ClarificationOptionCard } from "@/components/chat/ClarificationOptionCard";
import { OptionPreviewCarousel } from "@/components/chat/OptionPreviewCarousel";
import { useChatStore } from "@/components/chat/chat-store";
import {
  asNormalizedOptions,
  clarificationLooksLikeColorQuiz,
  CLARIFICATION_OTHER_OPTION,
  CLARIFICATION_OTHER_OPTION_ID,
  ensureQuestionsHaveQuickOptions,
  ensureRideAlongDefaults,
  formatClarificationAnswerDisplay,
} from "@/lib/fashion-memory/router/clarification-defaults";
import {
  ensureYouDecideOption,
  isConsultQuestion,
  isYouDecideOption,
  JUST_SHOW_ME_LABEL,
  YOU_DECIDE_OPTION_ID,
} from "@/lib/fashion-memory/router/consultation";
import {
  buildDoneAnswers,
  buildEscapeAnswers,
  canEscapePullSheet,
  canSubmitPullSheet,
  clampStepper,
  formatPullSheetMessage,
  preselectedOptionIds,
  resolveQuestionDisplay,
  seedStepperValue,
  stepperUnitLabel,
} from "@/lib/fashion-memory/router/pull-sheet";
import type {
  FashionClarificationAnswer,
  FashionClarificationOption,
  FashionClarificationQuestion,
  MessageFashionRouterMetaV1,
} from "@/lib/fashion-memory/router/types";

function resolveQuestionAnswer(
  selectedIds: string[],
  freeText: string,
): FashionClarificationAnswer | null {
  const custom = freeText.trim();
  const chipIds = selectedIds.filter((id) => id !== CLARIFICATION_OTHER_OPTION_ID);
  if (custom) return { selected: chipIds, customText: custom };
  if (!chipIds.length) return null;
  return { selected: chipIds };
}

function FashionQuizAnsweredBanner({
  questions,
  answers,
}: {
  questions: FashionClarificationQuestion[];
  answers?: Record<string, FashionClarificationAnswer>;
}) {
  const bits = questions
    .map((q) => {
      const a = formatClarificationAnswerDisplay(
        answers?.[q.text],
        q.quick_options,
      );
      return a ? `${q.text} → ${a}` : null;
    })
    .filter(Boolean) as string[];

  if (!bits.length) {
    return (
      <div className="shoop-qcardz text-xs text-ink-soft">
        You already answered this quiz.
      </div>
    );
  }

  return (
    <div className="shoop-qcardz text-xs text-ink-soft">
      <p className="shoop-qcardz__q">Your selections</p>
      <ul className="mt-1.5 list-inside list-disc space-y-0.5">
        {bits.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function ChipRow({
  options,
  selectedIds,
  disabled,
  variant,
  onToggle,
}: {
  options: FashionClarificationOption[];
  selectedIds: string[];
  disabled: boolean;
  variant: "chips" | "segment" | "size" | "garment";
  onToggle: (id: string) => void;
}) {
  const className =
    variant === "segment"
      ? "shoop-pullsheet__segment"
      : variant === "size"
        ? "shoop-pullsheet__size-grid"
        : variant === "garment"
          ? "shoop-pullsheet__garment"
          : "shoop-quiz-chips flex flex-wrap gap-2";
  return (
    <div className={className}>
      {options.map((option) => (
        <ClarificationOptionCard
          key={option.id}
          optionId={option.id}
          label={option.label}
          selected={selectedIds.includes(option.id)}
          disabled={disabled}
          onToggle={() => onToggle(option.id)}
        />
      ))}
    </div>
  );
}

function QuestionTreatment({
  question,
  selectedIds,
  freeText,
  disabled,
  onToggle,
  onFreeText,
}: {
  question: FashionClarificationQuestion;
  selectedIds: string[];
  freeText: string;
  disabled: boolean;
  onToggle: (optionId: string) => void;
  onFreeText: (text: string) => void;
}) {
  const options = asNormalizedOptions(
    question.quick_options ?? [
      { id: CLARIFICATION_OTHER_OPTION_ID, label: CLARIFICATION_OTHER_OPTION },
    ],
  );
  const youDecide = options.filter(isYouDecideOption);
  const other = options.filter((o) => o.id === CLARIFICATION_OTHER_OPTION_ID);
  const main = options.filter(
    (o) => o.id !== CLARIFICATION_OTHER_OPTION_ID && !isYouDecideOption(o),
  );
  const display = resolveQuestionDisplay(question);
  const preferPalette = clarificationLooksLikeColorQuiz(question);
  const showOtherInput =
    question.gap === "person_name" ||
    selectedIds.includes(CLARIFICATION_OTHER_OPTION_ID) ||
    Boolean(freeText.trim()) ||
    display === "text";

  const youDecideChip =
    youDecide.length && isConsultQuestion(question) ? (
      <ChipRow
        options={youDecide}
        selectedIds={selectedIds}
        disabled={disabled}
        variant="chips"
        onToggle={onToggle}
      />
    ) : null;

  if (display === "checklist") {
    return (
      <div className="space-y-2">
        <div className="shoop-pullsheet__check">
          {main.map((option) => {
            const on = selectedIds.includes(option.id);
            return (
              <label
                key={option.id}
                className={`shoop-pullsheet__check-row${on ? " shoop-pullsheet__check-row--on" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={() => onToggle(option.id)}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
        {youDecideChip}
      </div>
    );
  }

  if (display === "stepper") {
    const n = clampStepper(Number(freeText) || seedStepperValue(question));
    const unit = stepperUnitLabel(question);
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="shoop-pullsheet__stepper">
          <button
            type="button"
            disabled={disabled || n <= 1}
            onClick={() => onFreeText(String(n - 1))}
            aria-label="Fewer"
          >
            −
          </button>
          <span>
            {n} {unit}
          </span>
          <button
            type="button"
            disabled={disabled || n >= 8}
            onClick={() => onFreeText(String(n + 1))}
            aria-label="More"
          >
            +
          </button>
        </div>
        {youDecideChip}
      </div>
    );
  }

  if (display === "text") {
    return (
      <div className="space-y-2">
        <input
          type="text"
          value={freeText}
          disabled={disabled}
          onChange={(e) => onFreeText(e.target.value)}
          placeholder="Type a name"
          aria-label={question.text}
          className="shoop-quiz-other-input"
        />
        <ChipRow
          options={main.length ? main : other}
          selectedIds={selectedIds}
          disabled={disabled}
          variant="chips"
          onToggle={onToggle}
        />
      </div>
    );
  }

  if (display === "visual") {
    const visual = main.filter(
      (o) => preferPalette || o.previewQuery?.trim() || /surprise/i.test(o.label),
    );
    const leftover = main.filter((o) => !visual.includes(o));
    return (
      <div className="space-y-2">
        {visual.length ? (
          <div className="shoop-pullsheet__visual">
            {visual.map((o) => (
              <ClarificationOptionCard
                key={o.id}
                optionId={o.id}
                label={o.label}
                selected={selectedIds.includes(o.id)}
                disabled={disabled}
                previewQuery={o.previewQuery}
                previewImages={o.previewImages}
                paletteColors={o.paletteColors}
                preferPalette={preferPalette}
                onToggle={() => onToggle(o.id)}
              />
            ))}
          </div>
        ) : (
          <OptionPreviewCarousel bare>
            {main.map((o) => (
              <ClarificationOptionCard
                key={o.id}
                optionId={o.id}
                label={o.label}
                selected={selectedIds.includes(o.id)}
                disabled={disabled}
                previewQuery={o.previewQuery}
                previewImages={o.previewImages}
                paletteColors={o.paletteColors}
                preferPalette={preferPalette}
                onToggle={() => onToggle(o.id)}
              />
            ))}
          </OptionPreviewCarousel>
        )}
        {leftover.length ? (
          <ChipRow
            options={leftover}
            selectedIds={selectedIds}
            disabled={disabled}
            variant="chips"
            onToggle={onToggle}
          />
        ) : null}
        {youDecideChip}
        {other.length ? (
          <ChipRow
            options={other}
            selectedIds={selectedIds}
            disabled={disabled}
            variant="chips"
            onToggle={onToggle}
          />
        ) : null}
        {showOtherInput ? (
          <input
            type="text"
            value={freeText}
            disabled={disabled}
            onChange={(e) => onFreeText(e.target.value)}
            placeholder="or type it…"
            className="shoop-quiz-other-input"
          />
        ) : null}
      </div>
    );
  }

  const variant =
    question.gap === "department" || question.gap === "preference_anchor"
      ? "segment"
      : question.gap === "size"
        ? "size"
        : question.gap === "garment"
          ? "garment"
          : "chips";
  const rangeClass = display === "range" ? " shoop-pullsheet__range" : "";

  return (
    <div className={`space-y-2${rangeClass}`}>
      {question.gap === "size" && question.garment_type ? (
        <p className="text-[11px] font-medium text-ink-soft">
          {question.garment_type}
        </p>
      ) : null}
      <ChipRow
        options={main}
        selectedIds={selectedIds}
        disabled={disabled}
        variant={variant}
        onToggle={onToggle}
      />
      {youDecideChip}
      {other.length ? (
        <ChipRow
          options={other}
          selectedIds={selectedIds}
          disabled={disabled}
          variant="chips"
          onToggle={onToggle}
        />
      ) : null}
      {showOtherInput ? (
        <input
          type="text"
          value={freeText}
          disabled={disabled}
          onChange={(e) => onFreeText(e.target.value)}
          placeholder={
            display === "range" ? "$" : "or type it…"
          }
          inputMode={display === "range" ? "numeric" : "text"}
          className="shoop-quiz-other-input"
        />
      ) : null}
    </div>
  );
}

function rideAlongAsQuestion(
  rideAlong: NonNullable<MessageFashionRouterMetaV1["ride_along"]>,
): FashionClarificationQuestion {
  return {
    text: rideAlong.text,
    gap: "occasion",
    kind: "consult",
    quick_options: rideAlong.quick_options,
    allow_multiple: rideAlong.allow_multiple,
    allow_other: rideAlong.allow_other,
  };
}

export const FashionRouterControls = memo(function FashionRouterControls({
  messageId,
  fashionRouter,
}: {
  messageId: string;
  fashionRouter: MessageFashionRouterMetaV1;
}) {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setInput = useChatStore((s) => s.setInput);
  const answerFashionClarification = useChatStore(
    (s) => s.answerFashionClarification,
  );
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messages = useChatStore((s) => s.messages);

  const questions = useMemo(
    () =>
      ensureQuestionsHaveQuickOptions(fashionRouter.questions ?? []).map(
        ensureYouDecideOption,
      ),
    [fashionRouter.questions],
  );
  const rideAlong = useMemo(
    () => ensureRideAlongDefaults(fashionRouter.ride_along),
    [fashionRouter.ride_along],
  );
  const rideQuestion = rideAlong ? rideAlongAsQuestion(rideAlong) : null;
  const allQuestions = useMemo(
    () => (rideQuestion ? [...questions, rideQuestion] : questions),
    [questions, rideQuestion],
  );

  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const q of questions) {
      if (q.gap === "slots") out[q.text] = preselectedOptionIds(q);
    }
    return out;
  });
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const q of questions) {
      if (resolveQuestionDisplay(q) === "stepper") {
        out[q.text] = String(seedStepperValue(q));
      }
    }
    return out;
  });
  const [submitted, setSubmitted] = useState(false);

  const isClarification =
    fashionRouter.move === "ask_clarification" && questions.length > 0;
  const answeredByMeta = fashionRouter.status === "answered";
  const answeredByFollowUp = useMemo(() => {
    if (answeredByMeta || !isClarification) return false;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return false;
    return messages.slice(idx + 1).some((m) => m.role === "user");
  }, [answeredByMeta, isClarification, messageId, messages]);
  const isAnswered = answeredByMeta || answeredByFollowUp || submitted;

  const derivedAnswers = useMemo(() => {
    const out: Record<string, FashionClarificationAnswer> = {};
    for (const q of allQuestions) {
      const selected = selections[q.text] ?? [];
      const free = freeTexts[q.text] ?? "";
      if (resolveQuestionDisplay(q) === "stepper") {
        if (selected.includes(YOU_DECIDE_OPTION_ID)) {
          out[q.text] = { selected: [YOU_DECIDE_OPTION_ID] };
        } else if (free.trim()) {
          out[q.text] = { selected: [], customText: free.trim() };
        }
        continue;
      }
      const answer = resolveQuestionAnswer(selected, free);
      if (answer) out[q.text] = answer;
    }
    return out;
  }, [allQuestions, selections, freeTexts]);

  const blocking = questions.filter((q) => !isConsultQuestion(q));
  const consult = questions.filter((q) => isConsultQuestion(q));
  const disabled = isStreaming || submitted;
  const canDone = canSubmitPullSheet(allQuestions, derivedAnswers);
  const canEscape = canEscapePullSheet(questions, derivedAnswers);

  const toggleOption = (
    question: FashionClarificationQuestion,
    optionId: string,
  ) => {
    const display = resolveQuestionDisplay(question);
    const allowMultiple =
      Boolean(question.allow_multiple) ||
      display === "checklist" ||
      (display !== "stepper" &&
        display !== "text" &&
        question.gap !== "department" &&
        question.gap !== "person_name" &&
        question.gap !== "size" &&
        question.gap !== "garment" &&
        question.allow_multiple === true);
    const multi =
      display === "checklist" ||
      Boolean(question.allow_multiple) ||
      (question.gap === "occasion" && question.allow_multiple !== false);
    void allowMultiple;
    setSelections((prev) => {
      const current = prev[question.text] ?? [];
      if (optionId === YOU_DECIDE_OPTION_ID && display === "stepper") {
        const on = current.includes(YOU_DECIDE_OPTION_ID);
        return {
          ...prev,
          [question.text]: on ? [] : [YOU_DECIDE_OPTION_ID],
        };
      }
      if (multi && optionId !== YOU_DECIDE_OPTION_ID) {
        const withoutDecide = current.filter((id) => id !== YOU_DECIDE_OPTION_ID);
        const on = withoutDecide.includes(optionId);
        const next = on
          ? withoutDecide.filter((id) => id !== optionId)
          : [...withoutDecide, optionId];
        return { ...prev, [question.text]: next };
      }
      if (optionId !== CLARIFICATION_OTHER_OPTION_ID && display !== "text") {
        setFreeTexts((ft) => {
          if (display === "stepper") return ft;
          const next = { ...ft };
          delete next[question.text];
          return next;
        });
      }
      return { ...prev, [question.text]: [optionId] };
    });
  };

  const submit = (answers: Record<string, FashionClarificationAnswer>) => {
    answerFashionClarification(messageId, answers);
    setSubmitted(true);
    setInput(formatPullSheetMessage(questions, answers, rideQuestion));
    void sendMessage();
  };

  if (!isClarification) return null;
  if (isAnswered) {
    return (
      <FashionQuizAnsweredBanner
        questions={questions}
        answers={fashionRouter.answers}
      />
    );
  }

  const renderBlock = (q: FashionClarificationQuestion) => (
    <div key={q.text} className="shoop-qcardz__block">
      <p className="shoop-qcardz__q">{q.text}</p>
      <QuestionTreatment
        question={q}
        selectedIds={selections[q.text] ?? []}
        freeText={freeTexts[q.text] ?? ""}
        disabled={disabled}
        onToggle={(id) => toggleOption(q, id)}
        onFreeText={(text) => {
          if (resolveQuestionDisplay(q) === "stepper") {
            setSelections((prev) => ({
              ...prev,
              [q.text]: [],
            }));
            setFreeTexts((prev) => ({
              ...prev,
              [q.text]: String(clampStepper(Number(text) || 1)),
            }));
            return;
          }
          // Keep Other selected so the free-text field stays mounted while typing.
          setSelections((prev) => {
            const current = prev[q.text] ?? [];
            if (q.allow_multiple) {
              if (current.includes(CLARIFICATION_OTHER_OPTION_ID)) return prev;
              return {
                ...prev,
                [q.text]: [...current, CLARIFICATION_OTHER_OPTION_ID],
              };
            }
            return { ...prev, [q.text]: [CLARIFICATION_OTHER_OPTION_ID] };
          });
          setFreeTexts((prev) => ({ ...prev, [q.text]: text }));
        }}
      />
      {q.why && isConsultQuestion(q) ? (
        <p className="shoop-pullsheet__why">{q.why}</p>
      ) : null}
    </div>
  );

  return (
    <div className="shoop-qcardz shoop-pullsheet">
      {fashionRouter.known_summary ? (
        <p className="shoop-pullsheet__known">{fashionRouter.known_summary}</p>
      ) : null}
      <div className="shoop-pullsheet__grid">
        {blocking.map(renderBlock)}
        {blocking.length && (consult.length || rideQuestion) ? (
          <div className="shoop-pullsheet__hairline" />
        ) : null}
        {consult.map(renderBlock)}
        {rideQuestion ? renderBlock(rideQuestion) : null}
      </div>
      <button
        type="button"
        disabled={!canDone || disabled}
        onClick={() => {
          if (!canDone) return;
          submit(buildDoneAnswers(allQuestions, derivedAnswers));
        }}
        className="shoop-quiz-apply shoop-pullsheet__done mt-4"
      >
        Done
        <span aria-hidden>→</span>
      </button>
      {fashionRouter.escape_chip ? (
        <button
          type="button"
          disabled={!canEscape || disabled}
          onClick={() => {
            const answers = buildEscapeAnswers(questions, derivedAnswers);
            if (!answers) return;
            submit(answers);
          }}
          className="shoop-pullsheet__escape mt-3 w-full text-center text-sm text-ink-soft underline-offset-2 hover:underline disabled:opacity-40"
        >
          {fashionRouter.escape_chip ?? JUST_SHOW_ME_LABEL}
        </button>
      ) : null}
    </div>
  );
});
