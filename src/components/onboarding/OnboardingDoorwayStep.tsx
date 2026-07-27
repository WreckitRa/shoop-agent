"use client";

import { cn } from "@/lib/ai-chat/cn";

type Props = {
  onImportAi: () => void;
  onQuickQuiz: () => void;
};

export function OnboardingDoorwayStep({ onImportAi, onQuickQuiz }: Props) {
  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onImportAi}
          className={cn(
            "rounded-xl border border-neutral-200/80 bg-[#F5F3F0] p-5 text-left transition",
            "shadow-[inset_0_2px_5px_rgba(12,12,12,0.07),inset_0_-1px_0_rgba(255,255,255,0.85)]",
            "hover:border-neutral-300 hover:bg-[#F1EFEC]",
          )}
        >
          <div className="text-xl" aria-hidden>
            ⚡
          </div>
          <b className="mt-2 block text-[13.5px] font-bold text-ink">
            Import from your AI
          </b>
          <small className="mt-1 block text-[11.5px] font-normal leading-5 text-neutral-400">
            If you chat with ChatGPT, Claude, or another AI... it already knows
            your style. Fastest way in.
          </small>
        </button>
        <button
          type="button"
          onClick={onQuickQuiz}
          className={cn(
            "rounded-xl border border-[#E8A09C] bg-[#FDF1F0] p-5 text-left transition",
            "shadow-[inset_0_2px_6px_rgba(196,59,53,0.12),inset_0_-1px_0_rgba(255,255,255,0.7)]",
          )}
        >
          <div className="text-xl" aria-hidden>
            ✨
          </div>
          <b className="mt-2 block text-[13.5px] font-bold text-ink">
            Quick quiz
          </b>
          <small className="mt-1 block text-[11.5px] font-normal leading-5 text-neutral-400">
            About 2 minutes. Honestly kind of fun.
          </small>
        </button>
      </div>
    </section>
  );
}
