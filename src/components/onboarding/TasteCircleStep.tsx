"use client";

import { cn } from "@/lib/ai-chat/cn";
import {
  FittingKick,
  FittingNavRow,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";

const SLOT_PLACEHOLDERS = [
  "The one you text first",
  "And the honest one",
  "Third, if there is one",
] as const;

const SLOT_COUNT = 3;

type Props = {
  /** Up to 3 first names (sparse slots allowed). */
  names: string[];
  onChange: (names: string[]) => void;
  onContinue: () => void;
  onSkip: () => void;
  onSaveAccount?: () => void;
  busy?: boolean;
};

function normalizeSlots(names: string[]): string[] {
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => names[i] ?? "");
  return slots;
}

export function TasteCircleStep({
  names,
  onChange,
  onContinue,
  onSkip,
  onSaveAccount,
  busy,
}: Props) {
  const slots = normalizeSlots(names);

  function setSlot(index: number, value: string) {
    const next = [...slots];
    next[index] = value;
    onChange(next);
  }

  return (
    <section>
      <FittingKick>PERSON</FittingKick>
      <FittingTitle
        lines={[
          { text: "Who do you" },
          { text: "actually %%ask?%%", red: true },
        ]}
      />
      <FittingWhisper>
        When you&apos;re not sure about something, whose opinion do you take.{" "}
        <b>First names are enough.</b> In about ten seconds you&apos;ll have a
        verdict worth sending to them.
      </FittingWhisper>

      <div className="flex max-w-[440px] flex-col gap-2.5">
        {slots.map((value, i) => {
          const filled = value.trim().length > 0;
          return (
            <label
              key={SLOT_PLACEHOLDERS[i]}
              className={cn(
                "flex items-center gap-[13px] rounded-[14px] border-[1.5px] border-dashed border-[var(--fitting-g3)] bg-transparent px-[17px] py-[13px] transition-all duration-150",
                "focus-within:border-solid focus-within:border-[var(--fitting-ink)] focus-within:bg-white",
                filled &&
                  "border-solid border-[var(--fitting-ink)] bg-white",
              )}
            >
              <span
                className={cn(
                  "grid size-[29px] shrink-0 place-items-center rounded-full bg-[var(--fitting-mist)] font-display text-xs font-extrabold text-[#B7B7BF] transition-all",
                  filled && "bg-[var(--fitting-ink)] text-white",
                )}
              >
                {i + 1}
              </span>
              <input
                type="text"
                value={value}
                onChange={(e) => setSlot(i, e.target.value)}
                placeholder={SLOT_PLACEHOLDERS[i]}
                autoComplete="off"
                maxLength={40}
                className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[15.5px] font-semibold text-[var(--fitting-ink)] outline-none placeholder:font-medium placeholder:text-[#C3C3CB]"
              />
            </label>
          );
        })}
      </div>

      <p className="mt-4 max-w-[460px] text-[11.5px] leading-[1.6] text-[var(--fitting-quiet)] [&_b]:font-bold [&_b]:text-[var(--fitting-ink)]">
        Just names for now. <b>Nothing gets sent to anyone until you send it.</b>{" "}
        They vote in one tap, with no signup and nothing to install.
      </p>

      <FittingNavRow
        onNext={onContinue}
        busy={busy}
        nextLabel="Lock it in"
        enterHint={false}
        skip={{
          label: onSaveAccount
            ? "Continue without an account"
            : "I'd rather decide later",
          onClick: onSkip,
        }}
      />
      {onSaveAccount ? (
        <button
          type="button"
          onClick={onSaveAccount}
          disabled={busy}
          className="mt-3 border-0 bg-transparent p-0 font-sans text-[12.5px] font-semibold text-[var(--fitting-ink)] underline decoration-[#C4C4CC] underline-offset-4 hover:text-[var(--fitting-red)]"
        >
          Save to an account
        </button>
      ) : null}
    </section>
  );
}
