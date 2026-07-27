"use client";

import {
  GENDER_OPTIONS,
  STYLE_ERAS,
  WORLD_OPTIONS,
  ageYearsFromBirthDate,
  styleEraFromAge,
} from "@/lib/onboarding/form-options";
import {
  OnboardingChip,
  OnboardingQGroup,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";

export type YouIdentityValues = {
  preferredName: string;
  genderPresentation: string;
  birthDate: string;
  birthDateSkipped: boolean;
  styleEra: string;
  lifestyleTags: string[];
};

type Props = {
  values: YouIdentityValues;
  onChange: <K extends keyof YouIdentityValues>(
    key: K,
    value: YouIdentityValues[K],
  ) => void;
};

export function YouIdentityStep({ values, onChange }: Props) {
  function toggleWorld(tag: string) {
    const set = new Set(values.lifestyleTags);
    if (set.has(tag)) set.delete(tag);
    else set.add(tag);
    onChange("lifestyleTags", [...set]);
  }

  function onBirthdayChange(raw: string) {
    onChange("birthDate", raw);
    onChange("birthDateSkipped", false);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const age = ageYearsFromBirthDate(raw);
      if (age != null && !values.styleEra) {
        onChange("styleEra", styleEraFromAge(age));
      }
    }
  }

  return (
    <section className="space-y-1">
      <label className="block">
        <span className="sr-only">Your first name or nickname</span>
        <input
          type="text"
          value={values.preferredName}
          onChange={(e) => onChange("preferredName", e.target.value)}
          placeholder="Your first name or nickname"
          className="w-full rounded-xl border border-neutral-200 px-4 py-3.5 text-sm text-ink outline-none focus:border-brand"
          autoComplete="given-name"
        />
      </label>

      <OnboardingQGroup title="How do you shop for clothing?">
        <div className="flex flex-wrap gap-2">
          {GENDER_OPTIONS.map((opt) => (
            <OnboardingChip
              key={opt.value}
              selected={values.genderPresentation === opt.value}
              onClick={() => onChange("genderPresentation", opt.value)}
            >
              {opt.label}
            </OnboardingChip>
          ))}
        </div>
        <OnboardingWhy>
          This just decides which racks I open first... you can wander anywhere,
          anytime.
        </OnboardingWhy>
      </OnboardingQGroup>

      <OnboardingQGroup title="When's your birthday?">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={values.birthDate}
            onChange={(e) => onBirthdayChange(e.target.value)}
            disabled={values.birthDateSkipped}
            className="min-w-[200px] rounded-full border border-neutral-200 px-3.5 py-2 text-sm outline-none focus:border-brand disabled:opacity-50"
          />
          <OnboardingChip
            selected={values.birthDateSkipped}
            onClick={() => {
              onChange("birthDateSkipped", !values.birthDateSkipped);
              if (!values.birthDateSkipped) onChange("birthDate", "");
            }}
          >
            Prefer not to say
          </OnboardingChip>
        </div>
        <OnboardingWhy>
          Keeps things legal, maybe unlocks a little something on the day...
          never shown, never used to box you in.
        </OnboardingWhy>
      </OnboardingQGroup>

      <OnboardingQGroup
        title="Which era is your style living in?"
        hint="your birthday set a guess... move it if it's wrong. Style doesn't check ID."
      >
        <div className="flex flex-wrap gap-2">
          {STYLE_ERAS.map((era) => (
            <OnboardingChip
              key={era.value}
              selected={values.styleEra === era.value}
              onClick={() => onChange("styleEra", era.value)}
            >
              {era.label}
            </OnboardingChip>
          ))}
        </div>
      </OnboardingQGroup>

      <OnboardingQGroup
        title="What's your world these days?"
        hint="pick what fits"
      >
        <div className="flex flex-wrap gap-2">
          {WORLD_OPTIONS.map((opt) => (
            <OnboardingChip
              key={opt.value}
              selected={values.lifestyleTags.includes(opt.value)}
              onClick={() => toggleWorld(opt.value)}
            >
              {opt.label}
            </OnboardingChip>
          ))}
        </div>
        <OnboardingWhy>
          So I dress your actual life... not a demographic.
        </OnboardingWhy>
      </OnboardingQGroup>
    </section>
  );
}
