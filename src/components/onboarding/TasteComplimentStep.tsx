"use client";

import { COMPLIMENT_OPTIONS } from "@/lib/onboarding/form-options";
import {
  OnboardingChip,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
};

export function TasteComplimentStep({ values, onChange }: Props) {
  function toggle(value: string) {
    const set = new Set(values);
    if (set.has(value)) set.delete(value);
    else if (set.size < 2) set.add(value);
    onChange([...set]);
  }

  return (
    <section>
      <div className="mt-2 flex flex-wrap gap-2">
        {COMPLIMENT_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt}
            selected={values.includes(opt)}
            onClick={() => toggle(opt)}
            disabled={!values.includes(opt) && values.length >= 2}
          >
            {opt}
          </OnboardingChip>
        ))}
      </div>
      <OnboardingWhy>
        This tells me more than an hour of questions... it&apos;s the look
        you&apos;re reaching for.
      </OnboardingWhy>
    </section>
  );
}
