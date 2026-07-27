"use client";

import { HONESTY_OPTIONS } from "@/lib/onboarding/form-options";
import { cn } from "@/lib/ai-chat/cn";
import { OnboardingWhy } from "@/components/onboarding/onboarding-ui";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function TasteHonestyStep({ value, onChange }: Props) {
  return (
    <section>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {HONESTY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-[14px] border p-4 text-left transition",
              "shadow-[inset_0_2px_5px_rgba(12,12,12,0.07),inset_0_-1px_0_rgba(255,255,255,0.85)]",
              value === opt.value
                ? "border-[#E8A09C] bg-[#FDF1F0] text-[#C43B35] shadow-[inset_0_2px_6px_rgba(196,59,53,0.12),inset_0_-1px_0_rgba(255,255,255,0.7)]"
                : "border-neutral-200/80 bg-[#F5F3F0] hover:border-neutral-300 hover:bg-[#F1EFEC]",
            )}
          >
            <b className="mb-1.5 block text-[13.5px] font-bold">{opt.label}</b>
            <p className="text-[12.5px] italic leading-5 text-neutral-500">
              &ldquo;{opt.quote}&rdquo;
            </p>
          </button>
        ))}
      </div>
      <OnboardingWhy>
        I&apos;ll never tell you a dress works when it doesn&apos;t. This just
        sets how I break the news... and whatever I say no to, I&apos;ll always
        hand you a yes that gets you the same look.
      </OnboardingWhy>
    </section>
  );
}
