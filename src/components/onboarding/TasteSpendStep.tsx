"use client";

import { BUDGET_OPTIONS } from "@/lib/onboarding/form-options";
import {
  OnboardingTile,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function TasteSpendStep({ value, onChange }: Props) {
  return (
    <section>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {BUDGET_OPTIONS.map((opt) => (
          <OnboardingTile
            key={opt.value}
            selected={value === opt.value}
            onClick={() => onChange(opt.value)}
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
