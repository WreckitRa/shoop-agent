"use client";

import { useState } from "react";
import {
  CLIMATE_OPTIONS,
  KIDS_OPTIONS,
  WEEKEND_OPTIONS,
  WEEK_IS_OPTIONS,
  csvHas,
  parseCsvValues,
  toggleCsvValue,
} from "@/lib/onboarding/form-options";
import {
  FittingKick,
  FittingMulti,
  FittingNavRow,
  FittingQlbl,
  FittingTitle,
  FittingWhisper,
  OnboardingChip,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";

export type TasteLifeValues = {
  weekIs: string;
  weekendsAre: string;
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

const OTHER = "other";

function otherTextFromCsv(csv: string): string {
  for (const part of parseCsvValues(csv)) {
    if (part.startsWith("other:")) return part.slice(6);
  }
  return "";
}

function setOtherText(csv: string, text: string): string {
  const cleaned = parseCsvValues(csv).filter(
    (p) => p !== OTHER && !p.startsWith("other:"),
  );
  const trimmed = text.trim().replace(/,/g, " ");
  if (!trimmed) return [...cleaned, OTHER].join(",");
  return [...cleaned, `other:${trimmed}`].join(",");
}

function hasOther(csv: string): boolean {
  return parseCsvValues(csv).some((p) => p === OTHER || p.startsWith("other:"));
}

function toggleKnown(csv: string, value: string): string {
  if (value === OTHER) {
    return hasOther(csv)
      ? parseCsvValues(csv)
          .filter((p) => p !== OTHER && !p.startsWith("other:"))
          .join(",")
      : toggleCsvValue(csv, OTHER);
  }
  return toggleCsvValue(csv, value);
}

export function TasteLifeStep({ values, onChange, onContinue, busy }: Props) {
  const [weekOther, setWeekOther] = useState(otherTextFromCsv(values.weekIs));
  const [weekendOther, setWeekendOther] = useState(
    otherTextFromCsv(values.weekendsAre),
  );

  return (
    <section>
      <FittingKick>LIFE</FittingKick>
      <FittingTitle
        lines={[
          { text: "What does a week" },
          { text: "look like%%?%%", red: true },
        ]}
      />
      <FittingWhisper>
        Weekdays and weekends dress differently...{" "}
        <b>this is how I stop handing a student a boardroom look.</b>
      </FittingWhisper>

      <FittingQlbl>Your week days are:</FittingQlbl>
      <FittingMulti>PICK AS MANY AS ARE TRUE</FittingMulti>
      <div className="mt-3 flex max-w-[620px] flex-wrap gap-2.5">
        {WEEK_IS_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={csvHas(values.weekIs, opt.value)}
            onClick={() => onChange("weekIs", toggleKnown(values.weekIs, opt.value))}
          >
            {opt.label}
          </OnboardingChip>
        ))}
        <OnboardingChip
          selected={hasOther(values.weekIs)}
          onClick={() => onChange("weekIs", toggleKnown(values.weekIs, OTHER))}
        >
          Other
        </OnboardingChip>
      </div>
      {hasOther(values.weekIs) ? (
        <input
          type="text"
          value={weekOther}
          onChange={(e) => {
            setWeekOther(e.target.value);
            onChange("weekIs", setOtherText(values.weekIs, e.target.value));
          }}
          placeholder="What are your weekdays?"
          className="mt-3 w-full max-w-[420px] rounded-[13px] border-[1.5px] border-[var(--fitting-g3)] bg-white px-3.5 py-2.5 font-display text-[14px] font-bold text-[var(--fitting-ink)] outline-none focus:border-[var(--fitting-ink)]"
        />
      ) : null}

      <FittingQlbl>Your week ends are:</FittingQlbl>
      <FittingMulti>PICK AS MANY AS ARE TRUE</FittingMulti>
      <div className="mt-3 flex max-w-[620px] flex-wrap gap-2.5">
        {WEEKEND_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={csvHas(values.weekendsAre, opt.value)}
            onClick={() =>
              onChange(
                "weekendsAre",
                toggleKnown(values.weekendsAre, opt.value),
              )
            }
          >
            {opt.label}
          </OnboardingChip>
        ))}
        <OnboardingChip
          selected={hasOther(values.weekendsAre)}
          onClick={() =>
            onChange("weekendsAre", toggleKnown(values.weekendsAre, OTHER))
          }
        >
          Other
        </OnboardingChip>
      </div>
      {hasOther(values.weekendsAre) ? (
        <input
          type="text"
          value={weekendOther}
          onChange={(e) => {
            setWeekendOther(e.target.value);
            onChange(
              "weekendsAre",
              setOtherText(values.weekendsAre, e.target.value),
            );
          }}
          placeholder="What are your weekends?"
          className="mt-3 w-full max-w-[420px] rounded-[13px] border-[1.5px] border-[var(--fitting-g3)] bg-white px-3.5 py-2.5 font-display text-[14px] font-bold text-[var(--fitting-ink)] outline-none focus:border-[var(--fitting-ink)]"
        />
      ) : null}

      <FittingQlbl>Kids?</FittingQlbl>
      <FittingMulti>PICK AS MANY AS ARE TRUE</FittingMulti>
      <div className="mt-3 flex max-w-[620px] flex-wrap gap-2.5">
        {KIDS_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={csvHas(values.kids, opt.value)}
            onClick={() => onChange("kids", toggleCsvValue(values.kids, opt.value))}
          >
            {opt.label}
          </OnboardingChip>
        ))}
      </div>

      <FittingQlbl>Climate where you live</FittingQlbl>
      <FittingMulti>PICK AS MANY AS ARE TRUE</FittingMulti>
      <div className="mt-3 flex max-w-[620px] flex-wrap gap-2.5">
        {CLIMATE_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={csvHas(values.climate, opt.value)}
            onClick={() =>
              onChange("climate", toggleCsvValue(values.climate, opt.value))
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
