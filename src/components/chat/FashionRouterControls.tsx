"use client";

import { memo, useMemo, useState } from "react";
import { ClarificationOptionCard } from "@/components/chat/ClarificationOptionCard";
import { OptionPreviewCarousel } from "@/components/chat/OptionPreviewCarousel";
import { useChatStore } from "@/components/chat/chat-store";
import {
  asNormalizedOptions,
  CLARIFICATION_OTHER_OPTION,
  CLARIFICATION_OTHER_OPTION_ID,
  ensureQuestionsHaveQuickOptions,
  ensureRideAlongDefaults,
  formatClarificationAnswerDisplay,
} from "@/lib/fashion-memory/router/clarification-defaults";
import type {
  FashionClarificationAnswer,
  FashionClarificationQuestion,
  MessageFashionRouterMetaV1,
} from "@/lib/fashion-memory/router/types";

function formatBundledAnswers(
  questions: FashionClarificationQuestion[],
  answers: Record<string, FashionClarificationAnswer>,
  rideAlong?: { text: string; quick_options?: FashionClarificationQuestion["quick_options"] },
): string {
  const parts = questions
    .map((q) => {
      const display = formatClarificationAnswerDisplay(
        answers[q.text],
        q.quick_options,
      );
      if (!display) return null;
      return `${q.text} ${display}`;
    })
    .filter(Boolean);
  if (rideAlong) {
    const display = formatClarificationAnswerDisplay(
      answers[rideAlong.text],
      rideAlong.quick_options,
    );
    if (display) parts.push(`${rideAlong.text} ${display}`);
  }
  return parts.join(". ");
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

function resolveQuestionAnswer(
  selectedIds: string[],
  freeText: string,
): FashionClarificationAnswer | null {
  const custom = freeText.trim();
  const chipIds = selectedIds.filter((id) => id !== CLARIFICATION_OTHER_OPTION_ID);
  if (custom) {
    return {
      selected: chipIds,
      customText: custom,
    };
  }
  if (!chipIds.length) return null;
  return { selected: chipIds };
}

function looksLikeColorQuestion(text: string): boolean {
  return /\b(color|colours?|palette|shade|tones?)\b/i.test(text);
}

function QuestionOptions({
  question,
  selectedIds,
  freeText,
  disabled,
  onToggle,
  onFreeText,
  onFreeTextSubmit,
}: {
  question: FashionClarificationQuestion;
  selectedIds: string[];
  freeText: string;
  disabled: boolean;
  onToggle: (optionId: string) => void;
  onFreeText: (text: string) => void;
  onFreeTextSubmit?: () => void;
}) {
  const options = asNormalizedOptions(
    question.quick_options ?? [{ id: CLARIFICATION_OTHER_OPTION_ID, label: CLARIFICATION_OTHER_OPTION }],
  );
  const allowMultiple = Boolean(question.allow_multiple);
  const preferPalette = looksLikeColorQuestion(question.text);
  const visualOptions = options.filter(
    (o) =>
      o.id !== CLARIFICATION_OTHER_OPTION_ID &&
      (preferPalette ||
        o.previewQuery?.trim() ||
        /surprise/i.test(o.label) ||
        o.id === "surprise_me"),
  );
  const chipOptions = options.filter(
    (o) =>
      o.id !== CLARIFICATION_OTHER_OPTION_ID &&
      !preferPalette &&
      !o.previewQuery?.trim() &&
      !/surprise/i.test(o.label) &&
      o.id !== "surprise_me",
  );
  const hasVisualRow = visualOptions.length > 0;
  const canSubmitTyped = Boolean(freeText.trim()) && !disabled;

  return (
    <div className="space-y-2">
      {hasVisualRow ? (
        <OptionPreviewCarousel bare>
          {visualOptions.map((o) => (
            <ClarificationOptionCard
              key={o.id}
              optionId={o.id}
              label={o.label}
              selected={selectedIds.includes(o.id)}
              disabled={disabled}
              previewQuery={o.previewQuery}
              previewImages={o.previewImages}
              preferPalette={preferPalette}
              onToggle={() => onToggle(o.id)}
            />
          ))}
        </OptionPreviewCarousel>
      ) : null}
      {chipOptions.length ? (
        <div className="shoop-quiz-chips flex flex-wrap gap-2">
          {chipOptions.map((option) => (
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
      ) : null}
      {allowMultiple ? (
        <p className="text-[11px] text-ink-muted">Choose any that apply</p>
      ) : null}
      <input
        type="text"
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (!canSubmitTyped) return;
          onFreeTextSubmit?.();
        }}
        disabled={disabled}
        placeholder="or type it…"
        aria-label="Type your own answer"
        className="shoop-quiz-other-input"
      />
    </div>
  );
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
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const questions = useMemo(
    () => ensureQuestionsHaveQuickOptions(fashionRouter.questions ?? []),
    [fashionRouter.questions],
  );
  const rideAlong = useMemo(
    () => ensureRideAlongDefaults(fashionRouter.ride_along),
    [fashionRouter.ride_along],
  );
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

  const hasVisualCards = useMemo(
    () =>
      questions.some((q) =>
        asNormalizedOptions(q.quick_options).some((o) => o.previewQuery?.trim()),
      ) ||
      Boolean(
        rideAlong &&
          asNormalizedOptions(rideAlong.quick_options).some((o) =>
            o.previewQuery?.trim(),
          ),
      ),
    [questions, rideAlong],
  );

  const hasMulti = useMemo(
    () =>
      questions.some((q) => q.allow_multiple) ||
      Boolean(rideAlong?.allow_multiple),
    [questions, rideAlong],
  );

  const needsContinue =
    questions.length > 1 || Boolean(rideAlong) || hasMulti || hasVisualCards;

  const resolvedAnswers = useMemo(() => {
    const out: Record<string, FashionClarificationAnswer> = {};
    for (const q of questions) {
      const answer = resolveQuestionAnswer(
        selections[q.text] ?? [],
        freeTexts[q.text] ?? "",
      );
      if (answer) out[q.text] = answer;
    }
    if (rideAlong) {
      const answer = resolveQuestionAnswer(
        selections[rideAlong.text] ?? [],
        freeTexts[rideAlong.text] ?? "",
      );
      if (answer) out[rideAlong.text] = answer;
    }
    return out;
  }, [selections, freeTexts, questions, rideAlong]);

  const canSubmit = useMemo(() => {
    if (!isClarification) return false;
    return questions.every((q) => Boolean(resolvedAnswers[q.text]));
  }, [isClarification, questions, resolvedAnswers]);

  const toggleOption = (
    questionKey: string,
    optionId: string,
    allowMultiple: boolean,
  ) => {
    setSelections((prev) => {
      const current = prev[questionKey] ?? [];
      if (allowMultiple) {
        const on = current.includes(optionId);
        const next = on
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
        return { ...prev, [questionKey]: next };
      }
      // Single-select: replace (keep Other free text if switching away from Other)
      if (optionId !== CLARIFICATION_OTHER_OPTION_ID) {
        setFreeTexts((ft) => {
          const next = { ...ft };
          delete next[questionKey];
          return next;
        });
      }
      return { ...prev, [questionKey]: [optionId] };
    });
  };

  const submitAnswers = (
    finalAnswers: Record<string, FashionClarificationAnswer>,
  ) => {
    answerFashionClarification(messageId, finalAnswers);
    setSubmitted(true);
    setInput(formatBundledAnswers(questions, finalAnswers, rideAlong));
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

  // Single exclusive chip question with no visual cards: one-tap submit.
  if (!needsContinue) {
    const q = questions[0]!;
    const selected = selections[q.text] ?? [];
    const typed = freeTexts[q.text]?.trim() ?? "";
    const submitTyped = () => {
      if (!typed) return;
      submitAnswers({
        [q.text]: { selected: [], customText: typed },
      });
    };
    return (
      <div className="shoop-qcardz">
        <div className="shoop-qcardz__block">
          <p className="shoop-qcardz__q">{q.text}</p>
          <QuestionOptions
            question={q}
            selectedIds={selected}
            freeText={freeTexts[q.text] ?? ""}
            disabled={isStreaming || submitted}
            onToggle={(optionId) => {
              submitAnswers({
                [q.text]: { selected: [optionId] },
              });
            }}
            onFreeText={(text) => {
              setFreeTexts({ [q.text]: text });
            }}
            onFreeTextSubmit={submitTyped}
          />
        </div>
        {typed ? (
          <button
            type="button"
            disabled={isStreaming || submitted}
            onClick={submitTyped}
            className="shoop-quiz-apply mt-3"
          >
            Show me the rack
            <span aria-hidden>→</span>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="shoop-qcardz">
      {questions.map((q) => (
        <div key={q.text} className="shoop-qcardz__block">
          <p className="shoop-qcardz__q">{q.text}</p>
          <QuestionOptions
            question={q}
            selectedIds={selections[q.text] ?? []}
            freeText={freeTexts[q.text] ?? ""}
            disabled={isStreaming || submitted}
            onToggle={(optionId) =>
              toggleOption(q.text, optionId, Boolean(q.allow_multiple))
            }
            onFreeText={(text) => {
              if (!q.allow_multiple) {
                setSelections((prev) => ({ ...prev, [q.text]: [] }));
              }
              setFreeTexts((prev) => ({ ...prev, [q.text]: text }));
            }}
            onFreeTextSubmit={() => {
              if (!canSubmit || isStreaming || submitted) return;
              submitAnswers(resolvedAnswers);
            }}
          />
        </div>
      ))}
      {rideAlong ? (
        <div className="shoop-qcardz__block">
          <p className="shoop-qcardz__q">{rideAlong.text}</p>
          <QuestionOptions
            question={{
              text: rideAlong.text,
              gap: "occasion",
              quick_options: rideAlong.quick_options,
              allow_multiple: rideAlong.allow_multiple,
              allow_other: rideAlong.allow_other,
            }}
            selectedIds={selections[rideAlong.text] ?? []}
            freeText={freeTexts[rideAlong.text] ?? ""}
            disabled={isStreaming || submitted}
            onToggle={(optionId) =>
              toggleOption(
                rideAlong.text,
                optionId,
                Boolean(rideAlong.allow_multiple),
              )
            }
            onFreeText={(text) => {
              if (!rideAlong.allow_multiple) {
                setSelections((prev) => ({
                  ...prev,
                  [rideAlong.text]: [],
                }));
              }
              setFreeTexts((prev) => ({
                ...prev,
                [rideAlong.text]: text,
              }));
            }}
            onFreeTextSubmit={() => {
              if (!canSubmit || isStreaming || submitted) return;
              submitAnswers(resolvedAnswers);
            }}
          />
        </div>
      ) : null}
      <button
        type="button"
        disabled={!canSubmit || isStreaming || submitted}
        onClick={() => {
          if (!Object.keys(resolvedAnswers).length) return;
          submitAnswers(resolvedAnswers);
        }}
        className="shoop-quiz-apply mt-4"
      >
        Show me the rack
        <span aria-hidden>→</span>
      </button>
    </div>
  );
});
