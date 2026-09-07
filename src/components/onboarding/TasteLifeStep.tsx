"use client";

import { useState } from "react";
import {
  CLIMATE_OPTIONS,
  KIDS_OPTIONS,
  WEEKEND_OPTIONS,
  WEEK_IS_OPTIONS,
  WHY_HERE_OPTIONS,
  csvHas,
  joinCsvValues,
  parseCsvValues,
  toggleCsvValue,
} from "@/lib/onboarding/form-options";
import {
  FittingAddIn,
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
  dressingFor: string;
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

const OTHER_PREFIX = "other:";

function otherLabelsFromCsv(csv: string): string[] {
  const labels: string[] = [];
  for (const part of parseCsvValues(csv)) {
    if (!part.startsWith(OTHER_PREFIX)) continue;
    const label = part.slice(OTHER_PREFIX.length).trim();
    if (label) labels.push(label);
  }
  return labels;
}

function otherToken(label: string): string {
  return `${OTHER_PREFIX}${label.trim().replace(/,/g, " ")}`;
}

function addCustomCsv(
  csv: string,
  raw: string,
  options: readonly { value: string; label: string }[],
): string {
  const v = raw.trim().replace(/,/g, " ");
  if (!v) return csv;
  const known = options.find(
    (o) =>
      o.label.toLowerCase() === v.toLowerCase() ||
      o.value.toLowerCase() === v.toLowerCase(),
  );
  const token = known ? known.value : otherToken(v);
  const parts = parseCsvValues(csv).filter((p) => p !== "other");
  if (parts.includes(token)) return joinCsvValues(parts);
  return joinCsvValues([...parts, token]);
}

function dressingForCustoms(value: string, extras: string[]): string[] {
  const fromValue =
    value.startsWith(OTHER_PREFIX) && value.slice(6).trim()
      ? [value.slice(6).trim()]
      : [];
  const out = [...fromValue];
  for (const label of extras) {
    if (!out.some((x) => x.toLowerCase() === label.toLowerCase())) {
      out.push(label);
    }
  }
  return out;
}

export function TasteLifeStep({ values, onChange, onContinue, busy }: Props) {
  const [whyExtras, setWhyExtras] = useState<string[]>([]);
  const whyCustoms = dressingForCustoms(values.dressingFor, whyExtras);

  function addWhy(raw: string) {
    const v = raw.trim().replace(/,/g, " ");
    if (!v) return;
    const known = WHY_HERE_OPTIONS.find(
      (o) =>
        o.label.toLowerCase() === v.toLowerCase() ||
        o.value.toLowerCase() === v.toLowerCase(),
    );
    if (known) {
      onChange("dressingFor", known.value);
      return;
    }
    setWhyExtras((prev) =>
      prev.some((x) => x.toLowerCase() === v.toLowerCase())
        ? prev
        : [...prev, v],
    );
    onChange("dressingFor", otherToken(v));
  }

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

      <FittingQlbl>Why are you here?</FittingQlbl>
      <div className="mt-3 flex max-w-[620px] flex-wrap gap-2.5">
        {WHY_HERE_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={values.dressingFor === opt.value}
            onClick={() => onChange("dressingFor", opt.value)}
          >
            {opt.label}
          </OnboardingChip>
        ))}
        {whyCustoms.map((label) => {
          const token = otherToken(label);
          return (
            <OnboardingChip
              key={token}
              selected={values.dressingFor === token}
              onClick={() =>
                onChange(
                  "dressingFor",
                  values.dressingFor === token ? "" : token,
                )
              }
            >
              {label}
            </OnboardingChip>
          );
        })}
        <FittingAddIn placeholder="or type it…" onSubmit={addWhy} />
      </div>

      <FittingQlbl>Your week days are:</FittingQlbl>
      <FittingMulti>PICK AS MANY AS ARE TRUE</FittingMulti>
      <div className="mt-3 flex max-w-[620px] flex-wrap gap-2.5">
        {WEEK_IS_OPTIONS.map((opt) => (
          <OnboardingChip
            key={opt.value}
            selected={csvHas(values.weekIs, opt.value)}
            onClick={() =>
              onChange("weekIs", toggleCsvValue(values.weekIs, opt.value))
            }
          >
            {opt.label}
          </OnboardingChip>
        ))}
        {otherLabelsFromCsv(values.weekIs).map((label) => {
          const token = otherToken(label);
          return (
            <OnboardingChip
              key={token}
              selected={csvHas(values.weekIs, token)}
              onClick={() =>
                onChange("weekIs", toggleCsvValue(values.weekIs, token))
              }
            >
              {label}
            </OnboardingChip>
          );
        })}
        <FittingAddIn
          placeholder="or type it…"
          onSubmit={(v) =>
            onChange("weekIs", addCustomCsv(values.weekIs, v, WEEK_IS_OPTIONS))
          }
        />
      </div>

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
                toggleCsvValue(values.weekendsAre, opt.value),
              )
            }
          >
            {opt.label}
          </OnboardingChip>
        ))}
        {otherLabelsFromCsv(values.weekendsAre).map((label) => {
          const token = otherToken(label);
          return (
            <OnboardingChip
              key={token}
              selected={csvHas(values.weekendsAre, token)}
              onClick={() =>
                onChange(
                  "weekendsAre",
                  toggleCsvValue(values.weekendsAre, token),
                )
              }
            >
              {label}
            </OnboardingChip>
          );
        })}
        <FittingAddIn
          placeholder="or type it…"
          onSubmit={(v) =>
            onChange(
              "weekendsAre",
              addCustomCsv(values.weekendsAre, v, WEEKEND_OPTIONS),
            )
          }
        />
      </div>

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
