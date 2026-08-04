"use client";

import { HONESTY_OPTIONS } from "@/lib/onboarding/form-options";
import { cn } from "@/lib/ai-chat/cn";
import {
  FittingNavRow,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onContinue?: () => void;
  busy?: boolean;
};

export function TasteHonestyStep({
  value,
  onChange,
  onContinue,
  busy,
}: Props) {
  return (
    <section>
      <FittingTitle
        lines={[
          { text: "How honest" },
          { text: "do you want me?" },
        ]}
      />
      <FittingWhisper>
        I&apos;ll never say a piece works when it doesn&apos;t. This only sets how
        I break the news... and every no comes with a{" "}
        <b>yes that gets you the same look.</b>
      </FittingWhisper>

      <div className="flex max-w-[680px] flex-col gap-3 sm:flex-row">
        {HONESTY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 rounded-[14px] border border-[#D6D6DE] bg-white p-[18px_16px] text-left transition-all duration-150",
              "hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-12px_rgba(14,14,17,0.35)]",
              value === opt.value &&
                "border-[var(--fitting-red)] bg-[var(--fitting-mist)] shadow-[inset_0_3px_4px_-1px_rgba(14,14,17,0.22)]",
            )}
          >
            <b
              className={cn(
                "mb-2 block font-display text-[15px] font-extrabold",
                value === opt.value && "text-[var(--fitting-red)]",
              )}
            >
              {opt.label}
            </b>
            <i className="block font-whisper text-[12.5px] not-italic italic leading-[1.55] text-[var(--fitting-quiet)]">
              &ldquo;{opt.quote}&rdquo;
            </i>
          </button>
        ))}
      </div>

      {onContinue ? (
        <FittingNavRow
          onNext={onContinue}
          busy={busy}
          nextLabel="Lock it in... last one"
          enterHint={false}
        />
      ) : null}
    </section>
  );
}
