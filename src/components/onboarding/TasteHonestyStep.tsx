"use client";

import { HONESTY_OPTIONS } from "@/lib/onboarding/form-options";
import {
  FittingKick,
  FittingNavRow,
  FittingTitle,
  FittingWhisper,
  OnboardingTile,
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
      <FittingKick>PERSON</FittingKick>
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

      <div className="grid max-w-[680px] grid-cols-1 gap-2.5 sm:grid-cols-3">
        {HONESTY_OPTIONS.map((opt) => (
          <OnboardingTile
            key={opt.value}
            selected={value === opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.label}
            hint={`“${opt.quote}”`}
          />
        ))}
      </div>

      {onContinue ? (
        <FittingNavRow
          onNext={onContinue}
          busy={busy}
          nextLabel="Lock it in"
          enterHint={false}
        />
      ) : null}
    </section>
  );
}
