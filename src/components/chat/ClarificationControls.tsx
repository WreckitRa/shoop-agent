"use client";

import { memo, useCallback, useMemo, useState } from "react";
import {
  BudgetRangeControl,
  budgetRangeToAnswer,
  initialBudgetRangeValue,
  type BudgetRangeValue,
} from "@/components/chat/BudgetRangeControl";
import { useChatStore } from "@/components/chat/chat-store";
import {
  formatClarificationAnswerLine,
  ensureClarificationQuestions,
  isBudgetSliderQuestion,
  questionAllowsOther,
} from "@/lib/ai-chat/search-clarification";
import { ClarificationOptionCard } from "@/components/chat/ClarificationOptionCard";
import { OptionPreviewCarousel } from "@/components/chat/OptionPreviewCarousel";
import { CLARIFICATION_OTHER_OPTION_ID, type ClarificationQuestion, type MessageClarificationV1 } from "@/lib/ai-chat/types";

function looksLikeColorPrompt(text: string): boolean {
  return /\b(color|colours?|palette|shade|tones?)\b/i.test(text);
}

function ClarificationStatusBanner({
  clarification,
}: {
  clarification: MessageClarificationV1;
}) {
  if (clarification.status === "skipped") {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-hairline bg-surface-tint px-4 py-3 text-xs leading-5 text-ink-soft">
        You continued without filling this in — Shoop will use what you typed in
        chat instead.
      </div>
    );
  }

  if (clarification.status === "answered" && clarification.answers) {
    const bits: string[] = [];
    for (const q of ensureClarificationQuestions(clarification.questions)) {
      const a = clarification.answers[q.id];
      if (!a) continue;
      const line = formatClarificationAnswerLine(q, a);
      if (line) bits.push(line);
    }
    if (!bits.length) return null;
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

  return null;
}

function initialBudgetRanges(
  questions: ClarificationQuestion[],
): Record<string, BudgetRangeValue> {
  const init: Record<string, BudgetRangeValue> = {};
  for (const q of questions) {
    if (isBudgetSliderQuestion(q) && q.budgetSlider) {
      init[q.id] = initialBudgetRangeValue(q);
    }
  }
  return init;
}

export const ClarificationControls = memo(function ClarificationControls({
  messageId,
  clarification,
}: {
  messageId: string;
  clarification: MessageClarificationV1;
}) {
  const submitClarification = useChatStore((s) => s.submitClarification);
  const skipClarification = useChatStore((s) => s.skipClarification);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const q of ensureClarificationQuestions(clarification.questions)) {
      init[q.id] = [];
    }
    return init;
  });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [budgetRanges, setBudgetRanges] = useState<Record<string, BudgetRangeValue>>(
    () => initialBudgetRanges(ensureClarificationQuestions(clarification.questions)),
  );

  const busy = isStreaming;

  const questions = useMemo(
    () => ensureClarificationQuestions(clarification.questions),
    [clarification.questions],
  );

  const toggleOption = useCallback(
    (q: ClarificationQuestion, optionId: string) => {
      setSelections((s) => {
        const current = s[q.id] ?? [];
        const selected = current.includes(optionId);
        const isOther = optionId === CLARIFICATION_OTHER_OPTION_ID;

        if (q.allowMultiple) {
          const next = selected
            ? current.filter((id) => id !== optionId)
            : [...current, optionId];
          if (isOther && selected) {
            setCustom((c) => ({ ...c, [q.id]: "" }));
          }
          return { ...s, [q.id]: next };
        }

        if (selected) {
          if (isOther) setCustom((c) => ({ ...c, [q.id]: "" }));
          return { ...s, [q.id]: [] };
        }

        if (isOther) {
          return { ...s, [q.id]: [optionId] };
        }

        setCustom((c) => ({ ...c, [q.id]: "" }));
        return { ...s, [q.id]: [optionId] };
      });
    },
    [],
  );

  const buildAnswers = useCallback(() => {
    const answers: Record<
      string,
      {
        optionIds?: string[];
        customText?: string;
        budgetMin?: number | null;
        budgetMax?: number | null;
        currency?: string;
        budgetType?: "hard" | "soft";
      }
    > = {};
    for (const q of questions) {
      if (isBudgetSliderQuestion(q) && q.budgetSlider) {
        const range = budgetRanges[q.id] ?? initialBudgetRangeValue(q);
        answers[q.id] = budgetRangeToAnswer(range, {
          floor: 0,
          ceiling: q.budgetSlider.ceiling,
        });
        continue;
      }

      const optionIds = selections[q.id] ?? [];
      const extra = (custom[q.id] ?? "").trim();
      const otherSelected = optionIds.includes(CLARIFICATION_OTHER_OPTION_ID);
      const hasOpts = optionIds.length > 0;
      const hasExtra = Boolean(extra);
      if (!hasOpts && !hasExtra) continue;

      if (otherSelected && hasExtra) {
        answers[q.id] = { optionIds, customText: extra };
      } else if (otherSelected) {
        answers[q.id] = { optionIds };
      } else if (hasExtra) {
        answers[q.id] = { customText: extra };
      } else {
        answers[q.id] = { optionIds };
      }
    }
    return answers;
  }, [budgetRanges, questions, custom, selections]);

  const canSubmit = useMemo(() => {
    for (const q of questions) {
      if (q.optional) continue;

      if (isBudgetSliderQuestion(q)) {
        if (!budgetRanges[q.id] && !q.budgetSlider) return false;
        continue;
      }

      const optionIds = selections[q.id] ?? [];
      const extra = (custom[q.id] ?? "").trim();
      const otherSelected = optionIds.includes(CLARIFICATION_OTHER_OPTION_ID);
      const allowsOther = questionAllowsOther(q);

      if (!optionIds.length && !extra) return false;
      if (otherSelected && !extra) return false;
      if (!optionIds.length && extra && allowsOther && !otherSelected) return false;
      if (!optionIds.length && extra && !allowsOther) return false;
    }
    return true;
  }, [budgetRanges, questions, custom, selections]);

  if (clarification.status !== "pending") {
    return <ClarificationStatusBanner clarification={clarification} />;
  }

  return (
    <div className="shoop-qcardz">
      {questions.map((q: ClarificationQuestion) => {
        const preferPalette = looksLikeColorPrompt(q.prompt);
        const cardOptions = q.options.filter(
          (o) =>
            o.id !== CLARIFICATION_OTHER_OPTION_ID &&
            (preferPalette ||
              o.previewQuery?.trim() ||
              /surprise/i.test(o.label) ||
              o.id === "surprise_me"),
        );
        const chipOptions = q.options.filter(
          (o) =>
            o.id === CLARIFICATION_OTHER_OPTION_ID ||
            (!preferPalette &&
              !o.previewQuery?.trim() &&
              !/surprise/i.test(o.label) &&
              o.id !== "surprise_me"),
        );
        const hasVisualRow = cardOptions.length > 0;

        return (
          <div key={q.id} className="shoop-qcardz__block">
            <p className="shoop-qcardz__q">
              {q.prompt}
              {q.optional ? (
                <span className="ml-1.5 font-normal text-ink-muted">
                  (optional)
                </span>
              ) : null}
              {q.allowMultiple ? (
                <span className="ml-1.5 font-normal text-ink-muted">
                  (choose any that apply)
                </span>
              ) : null}
            </p>

            {isBudgetSliderQuestion(q) && q.budgetSlider ? (
              <BudgetRangeControl
                question={q}
                value={budgetRanges[q.id] ?? initialBudgetRangeValue(q)}
                disabled={busy}
                onChange={(value) =>
                  setBudgetRanges((current) => ({ ...current, [q.id]: value }))
                }
              />
            ) : (
              <>
                {hasVisualRow ? (
                  <OptionPreviewCarousel bare>
                    {cardOptions.map((o) => {
                      const on = (selections[q.id] ?? []).includes(o.id);
                      return (
                        <ClarificationOptionCard
                          key={o.id}
                          optionId={o.id}
                          label={o.label}
                          selected={on}
                          disabled={busy}
                          previewQuery={o.previewQuery}
                          previewImages={o.previewImages}
                          preferPalette={preferPalette}
                          onToggle={() => toggleOption(q, o.id)}
                        />
                      );
                    })}
                    {chipOptions
                      .filter((o) => o.id === CLARIFICATION_OTHER_OPTION_ID)
                      .map((o) => {
                        const on = (selections[q.id] ?? []).includes(o.id);
                        return (
                          <ClarificationOptionCard
                            key={o.id}
                            optionId={o.id}
                            label={o.label}
                            selected={on}
                            disabled={busy}
                            onToggle={() => toggleOption(q, o.id)}
                          />
                        );
                      })}
                  </OptionPreviewCarousel>
                ) : null}
                {chipOptions.filter((o) =>
                  hasVisualRow ? o.id !== CLARIFICATION_OTHER_OPTION_ID : true,
                ).length ? (
                  <div className="shoop-quiz-chips flex flex-wrap gap-2">
                    {chipOptions
                      .filter((o) =>
                        hasVisualRow
                          ? o.id !== CLARIFICATION_OTHER_OPTION_ID
                          : true,
                      )
                      .map((o) => {
                        const on = (selections[q.id] ?? []).includes(o.id);
                        return (
                          <ClarificationOptionCard
                            key={o.id}
                            optionId={o.id}
                            label={o.label}
                            selected={on}
                            disabled={busy}
                            onToggle={() => toggleOption(q, o.id)}
                          />
                        );
                      })}
                  </div>
                ) : null}
                {questionAllowsOther(q) &&
                (selections[q.id] ?? []).includes(CLARIFICATION_OTHER_OPTION_ID) ? (
                  <input
                    type="text"
                    disabled={busy}
                    autoFocus
                    placeholder="Tell us more…"
                    aria-label={`Custom answer for ${q.prompt}`}
                    value={custom[q.id] ?? ""}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, [q.id]: e.target.value }))
                    }
                    className="shoop-quiz-other-input"
                  />
                ) : null}
              </>
            )}
          </div>
        );
      })}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !canSubmit}
          onClick={() => void submitClarification(messageId, buildAnswers())}
          className="shoop-quiz-apply"
        >
          Show me the rack
          <span aria-hidden>→</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void skipClarification(messageId)}
          className="shoop-quiz-skip"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
});
