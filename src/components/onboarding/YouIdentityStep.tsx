"use client";

import { MIN_ACCOUNT_AGE } from "@/lib/legal/constants";
import {
  GENDER_OPTIONS,
  STYLE_ERAS,
  isAtLeastAge,
  maxBirthDateIso,
} from "@/lib/onboarding/form-options";
import {
  FittingField,
  FittingKick,
  FittingMulti,
  FittingNavRow,
  FittingQlbl,
  FittingTitle,
  FittingWhisper,
  OnboardingChip,
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
  onContinue?: () => void;
  busy?: boolean;
};

function toggleInList(list: string[], tag: string): string[] {
  const set = new Set(list);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  return [...set];
}

const ERA_SHORT: Record<string, string> = {
  "13_14": "13–14 Figuring it out",
  "15_17": "15–17 High-school",
  "18_22": "18–22 Campus",
  "23_29": "23–29 First-paycheck",
  "30s": "30s Prime",
  "40s": "40s Power",
  "50s_60s": "50s–60s Refined",
  "65_plus": "65+ Icon",
};

const MAX_BIRTH_DATE = maxBirthDateIso(MIN_ACCOUNT_AGE);

export function YouIdentityStep({
  values,
  onChange,
  onContinue,
  busy,
}: Props) {
  const underage =
    Boolean(values.birthDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(values.birthDate) &&
    !values.birthDateSkipped &&
    !isAtLeastAge(values.birthDate, MIN_ACCOUNT_AGE);

  return (
    <section>
      <FittingKick>LOOK · YOU</FittingKick>
      <FittingTitle
        lines={[
          { text: "What do we put" },
          { text: "on the print?" },
        ]}
      />
      <FittingWhisper>
        Your name claims it. Everything after develops it...{" "}
        <b>watch the twin on the right.</b>
      </FittingWhisper>

      <FittingField
        value={values.preferredName}
        onChange={(v) => onChange("preferredName", v)}
        placeholder="Your name"
        autoFocus
      />

      <FittingQlbl>Which type of clothings do you shop for?</FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
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
        This just decides which racks open first... you can wander anywhere,
        anytime.
      </OnboardingWhy>

      <FittingQlbl>When&apos;s your birthday?</FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap items-center gap-2.5">
        <input
          type="date"
          value={values.birthDate}
          max={MAX_BIRTH_DATE}
          disabled={values.birthDateSkipped}
          onChange={(e) => {
            onChange("birthDateSkipped", false);
            onChange("birthDate", e.target.value);
          }}
          className="min-w-[200px] rounded-[13px] border-[1.5px] border-[var(--fitting-g3)] bg-white px-3.5 py-2.5 font-display text-[15px] font-bold text-[var(--fitting-ink)] outline-none focus:border-[var(--fitting-ink)] disabled:opacity-50"
        />
        <OnboardingChip
          selected={values.birthDateSkipped}
          onClick={() => {
            const next = !values.birthDateSkipped;
            onChange("birthDateSkipped", next);
            if (next) onChange("birthDate", "");
          }}
        >
          Prefer not to say
        </OnboardingChip>
      </div>
      {underage ? (
        <p className="mt-2 text-xs font-semibold text-[var(--fitting-red)]">
          You need to be at least {MIN_ACCOUNT_AGE} to use Shoop.
        </p>
      ) : null}
      <OnboardingWhy>
        Keeps things legal, maybe unlocks a little something on the day... never
        shown, never used to box you in.
      </OnboardingWhy>

      <FittingQlbl hint="pick one or more... style doesn't check ID">
        Which era is your style living in?
      </FittingQlbl>
      <FittingMulti>PICK AS MANY AS ARE TRUE</FittingMulti>
      <div className="mt-3 flex max-w-[620px] flex-wrap gap-2">
        {STYLE_ERAS.map((era) => (
          <OnboardingChip
            key={era.value}
            selected={values.styleEras.includes(era.value)}
            onClick={() =>
              onChange("styleEras", toggleInList(values.styleEras, era.value))
            }
          >
            {ERA_SHORT[era.value] ?? era.label}
          </OnboardingChip>
        ))}
      </div>

      {onContinue ? (
        <FittingNavRow onNext={onContinue} busy={busy} />
      ) : null}
    </section>
  );
}
