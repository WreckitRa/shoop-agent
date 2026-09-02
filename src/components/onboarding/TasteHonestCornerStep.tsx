"use client";

import {
  FittingKick,
  FittingNavRow,
  FittingQlbl,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";

export const HONEST_CORNER_MAX = 2000;

type Props = {
  friction: string;
  become: string;
  onChangeFriction: (value: string) => void;
  onChangeBecome: (value: string) => void;
  onContinue?: () => void;
  onSkip?: () => void;
  busy?: boolean;
};

function HonestArea({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, HONEST_CORNER_MAX))}
      placeholder={placeholder}
      autoFocus={autoFocus}
      rows={3}
      maxLength={HONEST_CORNER_MAX}
      className="w-full max-w-[560px] resize-y border-0 border-b-[2.5px] border-[var(--fitting-ink)] bg-transparent py-2 font-sans text-[16px] leading-[1.5] text-[var(--fitting-ink)] outline-none placeholder:text-[#D9D9DE] focus:border-[var(--fitting-red)]"
    />
  );
}

export function TasteHonestCornerStep({
  friction,
  become,
  onChangeFriction,
  onChangeBecome,
  onContinue,
  onSkip,
  busy,
}: Props) {
  return (
    <section>
      <FittingKick>DIRECTION · HONEST CORNER</FittingKick>
      <FittingTitle
        lines={[
          { text: "The %%honest%%", red: true },
          { text: "corner." },
        ]}
      />
      <FittingWhisper>
        Be straight with me. What don&apos;t you like in how you dress now?
        And what do you want to improve — or become? I take this over the
        pretty pictures.
      </FittingWhisper>

      <FittingQlbl>What you don&apos;t like in your current style</FittingQlbl>
      <HonestArea
        value={friction}
        onChange={onChangeFriction}
        placeholder="Hoodies every day. Nothing that looks finished. Clothes that make me look younger than I am…"
        autoFocus
      />

      <FittingQlbl>What you want to improve or become</FittingQlbl>
      <HonestArea
        value={become}
        onChange={onChangeBecome}
        placeholder="More put-together without trying. Tailored. Like I chose this on purpose."
      />

      {onContinue ? (
        <FittingNavRow
          onNext={onContinue}
          busy={busy}
          nextLabel="That's the truth"
          enterHint={false}
          skip={
            onSkip
              ? { label: "I'd rather not say", onClick: onSkip }
              : undefined
          }
        />
      ) : null}
    </section>
  );
}
