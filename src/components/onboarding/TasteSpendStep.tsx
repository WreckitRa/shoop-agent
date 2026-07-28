"use client";

import { BUDGET_OPTIONS } from "@/lib/onboarding/form-options";
import {
  OnboardingTile,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
};

export function TasteSpendStep({ values, onChange }: Props) {
  function toggle(value: string) {
    const set = new Set(values);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    onChange([...set]);
  }

  return (
    <section>
      <p className="mb-2 text-xs text-neutral-400">Pick all that fit</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {BUDGET_OPTIONS.map((opt) => (
          <OnboardingTile
            key={opt.value}
            selected={values.includes(opt.value)}
            onClick={() => toggle(opt.value)}
            title={opt.label}
            hint={opt.hint}
          />
        ))}
      </div>
      <OnboardingWhy>
        I never rank by cheapest... I find the best match inside how YOU buy.
        Deals become a bonus, not the sort order.
      </OnboardingWhy>
    </section>
  );
}
