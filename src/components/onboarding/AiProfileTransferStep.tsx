"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, Check, Copy, Sparkles } from "lucide-react";
import {
  getAiAssistantOption,
  getTransferPrompt,
  PRIMARY_AI_ASSISTANTS,
  type PrimaryAiAssistantId,
} from "@/lib/onboarding/ai-transfer-prompts";
import { cn } from "@/lib/ai-chat/cn";

export type AiTransferPhase = "select" | "paste";

type Props = {
  phase: AiTransferPhase;
  selectedAi: PrimaryAiAssistantId | "";
  intakeText: string;
  onSelectAi: (id: PrimaryAiAssistantId) => void;
  onIntakeChange: (text: string) => void;
  onBackToSelect: () => void;
};

export function AiProfileTransferStep({
  phase,
  selectedAi,
  intakeText,
  onSelectAi,
  onIntakeChange,
  onBackToSelect,
}: Props) {
  const [copied, setCopied] = useState(false);
  const selectedOption = selectedAi ? getAiAssistantOption(selectedAi) : null;
  const prompt = selectedAi ? getTransferPrompt(selectedAi) : null;

  const copyPrompt = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [prompt]);

  if (phase === "select") {
    return (
      <section className="space-y-7">
        <div className="rounded-2xl border border-brand/15 bg-gradient-to-br from-brand-tint/80 via-white to-surface-tint/60 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-semibold tracking-tight text-ink">
                Already have a profile somewhere else?
              </p>
              <p className="text-sm leading-6 text-ink-secondary">
                Tell us which AI you use and we&apos;ll write a short message for you to copy.
                Paste it in, bring the reply back here, and you&apos;re set.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Which AI do you use most?</h3>
            <span className="text-xs text-ink-muted">Step 1 of 3</span>
          </div>

          <div
            className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3"
            role="radiogroup"
            aria-label="Primary AI assistant"
          >
            {PRIMARY_AI_ASSISTANTS.map((assistant) => (
              <button
                key={assistant.id}
                type="button"
                role="radio"
                aria-checked={false}
                onClick={() => onSelectAi(assistant.id)}
                className="group relative flex min-h-[4.5rem] flex-col items-start justify-center rounded-2xl border border-hairline bg-white px-3.5 py-3 text-left transition-all duration-200 ease-ios hover:border-brand/30 hover:bg-surface-tint/50 hover:shadow-[0_4px_20px_rgba(227,16,15,0.08)] active:scale-[0.98]"
              >
                <span className="text-sm font-semibold tracking-tight text-ink">
                  {assistant.label}
                </span>
                <span className="mt-0.5 text-xs text-ink-muted">{assistant.provider}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!selectedAi || !prompt || !selectedOption) {
    return null;
  }

  return (
    <section className="space-y-6">
      <button
        type="button"
        onClick={onBackToSelect}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Change AI
      </button>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">
            Copy this message into {selectedOption.label}
          </h3>
          <span className="text-xs text-ink-muted">Step 1 of 3</span>
        </div>
        <p className="text-sm leading-6 text-ink-secondary">
          Open a chat in {selectedOption.label}, paste the message, then copy what it writes and
          bring it back here.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface-tint/40">
        <div className="flex items-center justify-between gap-2 border-b border-hairline/80 bg-white/80 px-4 py-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Your message
          </span>
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ease-ios",
              copied
                ? "bg-success-tint text-success-dark"
                : "bg-brand text-white hover:bg-brand-dark",
            )}
            aria-label={copied ? "Copied to clipboard" : "Copy prompt"}
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="px-4 py-4 text-sm leading-7 text-ink">{prompt}</p>
      </div>

      <label className="block space-y-2.5">
        <div className="space-y-1">
          <span className="text-sm font-semibold text-ink">Paste what your AI wrote</span>
          <p className="text-xs leading-5 text-ink-muted">
            We&apos;ll pick up your sizes, brands, and preferences from here — no need to format
            anything.
          </p>
        </div>
        <textarea
          value={intakeText}
          onChange={(e) => onIntakeChange(e.target.value)}
          rows={9}
          autoFocus
          className="shoop-textarea-placeholder w-full resize-y rounded-2xl border border-hairline bg-white px-4 py-3.5 text-sm leading-6 text-ink outline-none transition-colors duration-150 ease-ios placeholder:text-ink-muted focus:border-brand/40 focus:ring-2 focus:ring-brand/15"
          placeholder="For example: I'm 28, live in Singapore, and usually shop in SGD. I like clean, minimal clothes, wear size M and EU 42 shoes, love Uniqlo and Aesop, and avoid fast fashion."
        />
      </label>
    </section>
  );
}
