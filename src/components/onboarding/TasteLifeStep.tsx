"use client";

import {
  CLIMATE_OPTIONS,
  DRESSING_FOR_OPTIONS,
  KIDS_OPTIONS,
  WEEK_IS_OPTIONS,
} from "@/lib/onboarding/form-options";
import {
  FittingNavRow,
  FittingQlbl,
  FittingTitle,
  FittingWhisper,
  OnboardingChip,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";

export type TasteLifeValues = {
  weekIs: string;
  dressingFor: string;
  kids: string;
  climate: string;
};

type Props = {
  values: TasteLifeValues;
  onChange: <K extends keyof TasteLifeValues>(
    key: K,
    value: TasteLifeValues[K],
  ) => void;
  onContinue?: () => void;
  busy?: boolean;
};

function pick(current: string, next: string): string {
  return current === next ? "" : next;
}

export function TasteLifeStep({ values, onChange, onContinue, busy }: Props) {
  return (
    <section>
      <FittingTitle
        lines={[
          { text: "What does a week" },
          { text: "look like%%?%%", red: true },
        ]}
      />
      <FittingWhisper>
        Three taps. This is how I stop handing a student a boardroom look...{" "}
        <b>or a parent a night-out they didn&apos;t ask for.</b>
      </FittingWhisper>

      <FittingQlbl>Your week is...</FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {WEEK_IS_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={values.weekIs === opt.value}
            onClick={() => onChange("weekIs", pick(values.weekIs, opt.value))}
          >
            {opt.label}
          </OnboardingChip>
        ))}
      </div>

      <FittingQlbl>Dressing for...</FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {DRESSING_FOR_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={values.dressingFor === opt.value}
            onClick={() =>
              onChange("dressingFor", pick(values.dressingFor, opt.value))
            }
          >
            {opt.label}
          </OnboardingChip>
        ))}
      </div>
      <OnboardingWhy>
        Dating, with someone, or not right now... it only changes which nights
        I dress.
      </OnboardingWhy>

      <FittingQlbl>Kids?</FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {KIDS_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={values.kids === opt.value}
            onClick={() => onChange("kids", pick(values.kids, opt.value))}
          >
            {opt.label}
          </OnboardingChip>
        ))}
      </div>

      <FittingQlbl>Climate where you live</FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {CLIMATE_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={values.climate === opt.value}
            onClick={() =>
              onChange("climate", pick(values.climate, opt.value))
            }
          >
            {opt.label}
          </OnboardingChip>
        ))}
      </div>
      <OnboardingWhy>
        Fabric weight, and whether a beach day even makes the list.
      </OnboardingWhy>

      {onContinue ? (
        <FittingNavRow onNext={onContinue} busy={busy} />
      ) : null}
    </section>
  );
}
