"use client";

import { BUDGET_OPTIONS } from "@/lib/onboarding/form-options";
import {
  FittingAddIn,
  FittingKick,
  FittingMulti,
  FittingNavRow,
  FittingTitle,
  FittingWhisper,
  OnboardingChip,
} from "@/components/onboarding/onboarding-ui";

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
  customLabels?: string[];
  onCustomLabelsChange?: (labels: string[]) => void;
  onContinue?: () => void;
  busy?: boolean;
};

export function TasteSpendStep({
  values,
  onChange,
  customLabels = [],
  onCustomLabelsChange,
  onContinue,
  busy,
}: Props) {
  function toggle(value: string) {
    const set = new Set(values);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    onChange([...set]);
  }

  function addCustom(raw: string) {
    const v = raw.trim();
    if (!v) return;
    const key = `custom:${v}`;
    if (!values.includes(key)) onChange([...values, key]);
    if (onCustomLabelsChange && !customLabels.includes(v)) {
      onCustomLabelsChange([...customLabels, v]);
    }
  }

  return (
    <section>
      <FittingKick>EVIDENCE</FittingKick>
      <FittingTitle
        lines={[
          { text: "How do you like" },
          { text: "to %%spend?%%", red: true },
        ]}
      />
      <FittingWhisper>
        I never rank by cheapest... I find the best match inside how{" "}
        <b>you</b> buy. Deals become a bonus, not the sort order.
      </FittingWhisper>
      <FittingMulti />

      <div className="mt-4 flex max-w-[640px] flex-wrap gap-2">
        {BUDGET_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={values.includes(opt.value)}
            onClick={() => toggle(opt.value)}
          >
            {opt.label}
          </OnboardingChip>
        ))}
        {customLabels.map((label) => {
          const key = `custom:${label}`;
          return (
            <OnboardingChip
              key={key}
              selected={values.includes(key)}
              onClick={() => toggle(key)}
            >
              {label}
            </OnboardingChip>
          );
        })}
        <FittingAddIn
          placeholder="or type it…"
          onSubmit={addCustom}
        />
      </div>

      {onContinue ? (
        <FittingNavRow onNext={onContinue} busy={busy} />
      ) : null}
    </section>
  );
}
