"use client";

import { memo, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ClarificationOptionCard } from "@/components/chat/ClarificationOptionCard";
import { OptionPreviewCarousel } from "@/components/chat/OptionPreviewCarousel";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";
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
  answers: Record<string, FashionClarificationAnswer | string>,
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
  answers?: Record<string, FashionClarificationAnswer | string>;
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
      <div className="mt-3 rounded-2xl border border-hairline bg-surface-tint px-4 py-3 text-xs text-ink-soft">
        You already answered this quiz.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-hairline bg-surface-tint px-4 py-3 text-xs text-ink-soft">
      <p className="font-medium text-ink">Your selections</p>
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
  const otherSelected = selectedIds.includes(CLARIFICATION_OTHER_OPTION_ID);
  const chipIds = selectedIds.filter((id) => id !== CLARIFICATION_OTHER_OPTION_ID);
  const custom = freeText.trim();
  if (!chipIds.length && !(otherSelected && custom)) return null;
  // If they typed free text without tapping Other, still accept it.
  if (!chipIds.length && custom && !otherSelected) {
    return { selected: [], customText: custom };
  }
  return {
    selected: chipIds,
    ...(otherSelected && custom ? { customText: custom } : {}),
  };
}

function QuestionOptions({
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
    question.quick_options ?? [{ id: CLARIFICATION_OTHER_OPTION_ID, label: CLARIFICATION_OTHER_OPTION }],
  );
  const allowMultiple = Boolean(question.allow_multiple);
  const cardOptions = options.filter(
    (o) =>
      o.previewQuery?.trim() &&
      o.id !== CLARIFICATION_OTHER_OPTION_ID,
  );
  const chipOptions = options.filter(
    (o) =>
      !o.previewQuery?.trim() ||
      o.id === CLARIFICATION_OTHER_OPTION_ID,
  );
  const otherSelected = selectedIds.includes(CLARIFICATION_OTHER_OPTION_ID);

  return (
    <div className="space-y-2">
      {cardOptions.length ? (
        <OptionPreviewCarousel title="Explore ideas">
          {cardOptions.map((o) => (
            <ClarificationOptionCard
              key={o.id}
              optionId={o.id}
              label={o.label}
              selected={selectedIds.includes(o.id)}
              disabled={disabled}
              previewQuery={o.previewQuery}
              previewImages={o.previewImages}
              onToggle={() => onToggle(o.id)}
            />
          ))}
        </OptionPreviewCarousel>
      ) : null}
      {chipOptions.length ? (
        <div className="flex flex-wrap gap-2">
          {chipOptions.map((option) => {
            const selected = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onToggle(option.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
                  selected
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-hairline bg-surface text-ink hover:border-brand/40",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {allowMultiple ? (
        <p className="text-[11px] text-ink-muted">Choose any that apply</p>
      ) : null}
      {otherSelected ? (
        <input
          type="text"
          value={freeText}
          onChange={(e) => onFreeText(e.target.value)}
          disabled={disabled}
          placeholder="Type your answer…"
          className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand/40 focus:outline-none disabled:opacity-50"
          autoFocus
        />
      ) : null}
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

  const legacyOptions =
    fashionRouter.move === "ask_clarification" && !questions.length
      ? asNormalizedOptions(fashionRouter.quick_options)
      : [];

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
    finalAnswers: Record<string, FashionClarificationAnswer | string>,
  ) => {
    answerFashionClarification(messageId, finalAnswers);
    setSubmitted(true);
    setInput(formatBundledAnswers(questions, finalAnswers, rideAlong));
    void sendMessage();
  };

  if (!isClarification && !legacyOptions.length) return null;

  if (isAnswered && isClarification) {
    return (
      <FashionQuizAnsweredBanner
        questions={questions}
        answers={fashionRouter.answers}
      />
    );
  }

  if (legacyOptions.length) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {legacyOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={isStreaming}
            onClick={() => {
              answerFashionClarification(messageId, {
                [option.label]: {
                  selected: [option.id],
                },
              });
              setSubmitted(true);
              setInput(option.label);
              void sendMessage();
            }}
            className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-brand/40 hover:bg-surface-tint disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  // Single exclusive chip question with no visual cards: one-tap submit.
  if (!needsContinue && questions.length === 1) {
    const q = questions[0]!;
    const selected = selections[q.text] ?? [];
    const otherOpen = selected.includes(CLARIFICATION_OTHER_OPTION_ID);
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm text-ink">{q.text}</p>
        <QuestionOptions
          question={q}
          selectedIds={selected}
          freeText={freeTexts[q.text] ?? ""}
          disabled={isStreaming || submitted}
          onToggle={(optionId) => {
            if (optionId === CLARIFICATION_OTHER_OPTION_ID) {
              toggleOption(q.text, optionId, false);
              return;
            }
            submitAnswers({
              [q.text]: { selected: [optionId] },
            });
          }}
          onFreeText={(text) => {
            toggleOption(q.text, CLARIFICATION_OTHER_OPTION_ID, false);
            setFreeTexts({ [q.text]: text });
          }}
        />
        {otherOpen ? (
          <button
            type="button"
            disabled={
              !freeTexts[q.text]?.trim() || isStreaming || submitted
            }
            onClick={() => {
              const typed = freeTexts[q.text]?.trim();
              if (!typed) return;
              submitAnswers({
                [q.text]: { selected: [], customText: typed },
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Continue
            <ArrowRight className="size-3.5" strokeWidth={2.25} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-hairline bg-surface-tint/60 p-3">
      {questions.map((q) => (
        <div key={q.text} className="space-y-2">
          <p className="text-sm text-ink">{q.text}</p>
          <QuestionOptions
            question={q}
            selectedIds={selections[q.text] ?? []}
            freeText={freeTexts[q.text] ?? ""}
            disabled={isStreaming || submitted}
            onToggle={(optionId) =>
              toggleOption(q.text, optionId, Boolean(q.allow_multiple))
            }
            onFreeText={(text) => {
              setSelections((prev) => {
                const cur = prev[q.text] ?? [];
                const withOther = cur.includes(CLARIFICATION_OTHER_OPTION_ID)
                  ? cur
                  : [...cur, CLARIFICATION_OTHER_OPTION_ID];
                return { ...prev, [q.text]: withOther };
              });
              setFreeTexts((prev) => ({ ...prev, [q.text]: text }));
            }}
          />
        </div>
      ))}
      {rideAlong ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-soft">{rideAlong.text}</p>
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
              setSelections((prev) => {
                const cur = prev[rideAlong.text] ?? [];
                const withOther = cur.includes(CLARIFICATION_OTHER_OPTION_ID)
                  ? cur
                  : [...cur, CLARIFICATION_OTHER_OPTION_ID];
                return { ...prev, [rideAlong.text]: withOther };
              });
              setFreeTexts((prev) => ({ ...prev, [rideAlong.text]: text }));
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
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        Continue
        <ArrowRight className="size-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
});
