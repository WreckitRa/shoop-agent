"use client";

import {
  GENDER_OPTIONS,
  WORLD_OPTIONS,
  ageYearsFromBirthDate,
  isAtLeastAge,
  maxBirthDateIso,
  styleEraFromAge,
  styleErasForAge,
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
  styleEras: string[];
  lifestyleTags: string[];
};

type Props = {
  values: YouIdentityValues;
  onChange: <K extends keyof YouIdentityValues>(
    key: K,
    value: YouIdentityValues[K],
  ) => void;
};

function toggleInList(list: string[], tag: string): string[] {
  const set = new Set(list);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  return [...set];
}

const MIN_AGE = 13;
const MAX_BIRTH_DATE = maxBirthDateIso(MIN_AGE);

export function YouIdentityStep({ values, onChange }: Props) {
  const ageYears =
    !values.birthDateSkipped &&
    /^\d{4}-\d{2}-\d{2}$/.test(values.birthDate) &&
    isAtLeastAge(values.birthDate, MIN_AGE)
      ? ageYearsFromBirthDate(values.birthDate)
      : null;
  const eraOptions = styleErasForAge(ageYears);
  const underage =
    Boolean(values.birthDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(values.birthDate) &&
    !isAtLeastAge(values.birthDate, MIN_AGE);

  function onBirthdayChange(raw: string) {
    onChange("birthDateSkipped", false);
    if (!raw) {
      onChange("birthDate", "");
      return;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !isAtLeastAge(raw, MIN_AGE)) {
      onChange("birthDate", raw);
      return;
    }
    onChange("birthDate", raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const age = ageYearsFromBirthDate(raw);
      if (age != null) {
        const guess = styleEraFromAge(age);
        const allowed = new Set(
          styleErasForAge(age).map((e) => e.value as string),
        );
        const kept = values.styleEras.filter((e) => allowed.has(e));
        if (kept.length === 0) {
          onChange("styleEras", [guess]);
        } else if (!kept.includes(guess)) {
          onChange("styleEras", [guess, ...kept.filter((e) => e !== guess)]);
        } else {
          onChange("styleEras", kept);
        }
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
            max={MAX_BIRTH_DATE}
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
        {underage ? (
          <p className="mt-2 text-xs text-red-700">
            You need to be at least {MIN_AGE} to use Shoop.
          </p>
        ) : null}
        <OnboardingWhy>
          Keeps things legal, maybe unlocks a little something on the day...
          never shown, never used to box you in.
        </OnboardingWhy>
      </OnboardingQGroup>

      <OnboardingQGroup
        title="Which era is your style living in?"
        hint={
          ageYears != null
            ? "birthday narrowed these… pick one or more. Style doesn't check ID."
            : "pick one or more. Style doesn't check ID."
        }
      >
        <div className="flex flex-wrap gap-2">
          {eraOptions.map((era) => (
            <OnboardingChip
              key={era.value}
              selected={values.styleEras.includes(era.value)}
              onClick={() =>
                onChange("styleEras", toggleInList(values.styleEras, era.value))
              }
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
              onClick={() =>
                onChange(
                  "lifestyleTags",
                  toggleInList(values.lifestyleTags, opt.value),
                )
              }
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
