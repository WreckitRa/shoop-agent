"use client";

import { memo, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";
import {
  CLARIFICATION_OTHER_OPTION,
  ensureQuestionsHaveQuickOptions,
} from "@/lib/fashion-memory/router/clarification-defaults";
import type {
  FashionClarificationQuestion,
  MessageFashionRouterMetaV1,
} from "@/lib/fashion-memory/router/types";

function formatBundledAnswers(
  questions: FashionClarificationQuestion[],
  answers: Record<string, string>,
  rideAlong?: { text: string },
  rideAlongAnswer?: string,
): string {
  const parts = questions
    .map((q) => {
      const answer = answers[q.text]?.trim();
      if (!answer) return null;
      return `${q.text} ${answer}`;
    })
    .filter(Boolean);
  if (rideAlong && rideAlongAnswer?.trim()) {
    parts.push(`${rideAlong.text} ${rideAlongAnswer.trim()}`);
  }
  return parts.join(". ");
}

function FashionQuizAnsweredBanner({
  questions,
  answers,
}: {
  questions: FashionClarificationQuestion[];
  answers?: Record<string, string>;
}) {
  const bits = questions
    .map((q) => {
      const a = answers?.[q.text]?.trim();
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

function QuestionOptions({
  question,
  value,
  freeText,
  disabled,
  onSelect,
  onFreeText,
}: {
  question: FashionClarificationQuestion;
  value: string;
  freeText: string;
  disabled: boolean;
  onSelect: (option: string) => void;
  onFreeText: (text: string) => void;
}) {
  const options = question.quick_options ?? [CLARIFICATION_OTHER_OPTION];
  const otherSelected =
    value === CLARIFICATION_OTHER_OPTION ||
    (Boolean(value) && !options.includes(value));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected =
            option === CLARIFICATION_OTHER_OPTION
              ? otherSelected
              : value === option;
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(option)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
                selected
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-hairline bg-surface text-ink hover:border-brand/40",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>({});
  const [rideAlongAnswer, setRideAlongAnswer] = useState("");
  const [rideAlongFree, setRideAlongFree] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const questions = useMemo(
    () => ensureQuestionsHaveQuickOptions(fashionRouter.questions ?? []),
    [fashionRouter.questions],
  );
  const isClarification =
    fashionRouter.move === "ask_clarification" && questions.length > 0;
  const rideAlong = fashionRouter.ride_along;

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
      ? (fashionRouter.quick_options ?? [])
      : [];

  const resolvedAnswers = useMemo(() => {
    const out: Record<string, string> = {};
    for (const q of questions) {
      const selected = answers[q.text];
      if (!selected) continue;
      if (selected === CLARIFICATION_OTHER_OPTION) {
        const typed = freeTexts[q.text]?.trim();
        if (typed) out[q.text] = typed;
      } else {
        out[q.text] = selected;
      }
    }
    return out;
  }, [answers, freeTexts, questions]);

  const canSubmit = useMemo(() => {
    if (!isClarification) return false;
    return questions.every((q) => resolvedAnswers[q.text]?.trim());
  }, [isClarification, questions, resolvedAnswers]);

  const submitAnswers = (finalAnswers: Record<string, string>) => {
    answerFashionClarification(messageId, finalAnswers);
    setSubmitted(true);
    setInput(
      formatBundledAnswers(
        questions,
        finalAnswers,
        rideAlong,
        finalAnswers[rideAlong?.text ?? ""],
      ),
    );
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
            key={option}
            type="button"
            disabled={isStreaming}
            onClick={() => {
              answerFashionClarification(messageId, { [option]: option });
              setSubmitted(true);
              setInput(option);
              void sendMessage();
            }}
            className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-brand/40 hover:bg-surface-tint disabled:opacity-50"
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  // Single question: one-tap chips; Other reveals free-form + Continue.
  if (questions.length === 1 && !rideAlong) {
    const q = questions[0]!;
    const selected = answers[q.text] ?? "";
    const otherOpen = selected === CLARIFICATION_OTHER_OPTION;
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm text-ink">{q.text}</p>
        <QuestionOptions
          question={q}
          value={selected}
          freeText={freeTexts[q.text] ?? ""}
          disabled={isStreaming || submitted}
          onSelect={(option) => {
            if (option === CLARIFICATION_OTHER_OPTION) {
              setAnswers({ [q.text]: option });
              return;
            }
            submitAnswers({ [q.text]: option });
          }}
          onFreeText={(text) => {
            setAnswers({ [q.text]: CLARIFICATION_OTHER_OPTION });
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
              submitAnswers({ [q.text]: typed });
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

  const rideAlongOptions = rideAlong
    ? [
        ...rideAlong.quick_options.filter(
          (o) => o.toLowerCase() !== CLARIFICATION_OTHER_OPTION.toLowerCase(),
        ),
        CLARIFICATION_OTHER_OPTION,
      ]
    : [];

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-hairline bg-surface-tint/60 p-3">
      {questions.map((q) => (
        <div key={q.text} className="space-y-2">
          <p className="text-sm text-ink">{q.text}</p>
          <QuestionOptions
            question={q}
            value={answers[q.text] ?? ""}
            freeText={freeTexts[q.text] ?? ""}
            disabled={isStreaming || submitted}
            onSelect={(option) => {
              setAnswers((prev) => ({ ...prev, [q.text]: option }));
              if (option !== CLARIFICATION_OTHER_OPTION) {
                setFreeTexts((prev) => {
                  const next = { ...prev };
                  delete next[q.text];
                  return next;
                });
              }
            }}
            onFreeText={(text) => {
              setAnswers((prev) => ({
                ...prev,
                [q.text]: CLARIFICATION_OTHER_OPTION,
              }));
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
              quick_options: rideAlongOptions,
            }}
            value={rideAlongAnswer}
            freeText={rideAlongFree}
            disabled={isStreaming || submitted}
            onSelect={(option) => {
              setRideAlongAnswer(option);
              if (option !== CLARIFICATION_OTHER_OPTION) setRideAlongFree("");
            }}
            onFreeText={(text) => {
              setRideAlongAnswer(CLARIFICATION_OTHER_OPTION);
              setRideAlongFree(text);
            }}
          />
        </div>
      ) : null}
      <button
        type="button"
        disabled={!canSubmit || isStreaming || submitted}
        onClick={() => {
          const rideResolved =
            rideAlongAnswer === CLARIFICATION_OTHER_OPTION
              ? rideAlongFree.trim()
              : rideAlongAnswer.trim();
          const finalAnswers = { ...resolvedAnswers };
          if (rideAlong && rideResolved) {
            finalAnswers[rideAlong.text] = rideResolved;
          }
          if (!Object.keys(finalAnswers).length) return;
          submitAnswers(finalAnswers);
        }}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        Continue
        <ArrowRight className="size-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
});
