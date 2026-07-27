"use client";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { cityOptionsForCountry } from "@/lib/onboarding/cities";
import {
  BOTTOM_SIZE_OPTIONS,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  SHOE_SIZE_OPTIONS,
  TOP_SIZE_OPTIONS,
  currencyHintForCountry,
} from "@/lib/onboarding/form-options";
import {
  OnboardingQGroup,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";

export type YouLocationValues = {
  city: string;
  shippingCountry: string;
  currency: string;
  topSize: string;
  bottomSize: string;
  shoeEU: string;
  locationConfirmed: boolean;
};

type Props = {
  values: YouLocationValues;
  suggestedLabel: string | null;
  onChange: <K extends keyof YouLocationValues>(
    key: K,
    value: YouLocationValues[K],
  ) => void;
  onConfirmSuggested: () => void;
  onChangeLocation: () => void;
};

export function YouLocationSizesStep({
  values,
  suggestedLabel,
  onChange,
  onConfirmSuggested,
  onChangeLocation,
}: Props) {
  const showConfirm =
    Boolean(suggestedLabel) && !values.locationConfirmed && !values.shippingCountry;

  const cityOptions = cityOptionsForCountry(values.shippingCountry);

  function handleCountryChange(country: string) {
    onChange("shippingCountry", country);
    onChange("locationConfirmed", true);
    onChange("city", "");
    if (!values.currency) {
      const hint = currencyHintForCountry(country);
      if (hint) onChange("currency", hint);
    }
  }

  return (
    <section className="space-y-4">
      {showConfirm ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#CDE8DA] bg-[#F6FBF8] px-4 py-3.5 text-sm leading-6">
          <span>
            Looks like <b>{suggestedLabel}</b> ✓ ... right?
          </span>
          <button
            type="button"
            onClick={onConfirmSuggested}
            className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-white"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={onChangeLocation}
            className="rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-semibold"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <SearchableSelect
            label="Country"
            value={values.shippingCountry}
            onChange={handleCountryChange}
            options={COUNTRY_OPTIONS}
            placeholder="Select country"
            searchPlaceholder="Search countries…"
          />
          <div
            className={
              values.shippingCountry ? undefined : "pointer-events-none opacity-50"
            }
          >
            <SearchableSelect
              label="City"
              value={values.city}
              onChange={(city) => onChange("city", city)}
              options={cityOptions}
              placeholder={
                values.shippingCountry
                  ? cityOptions.length
                    ? "Select city"
                    : "Type your city"
                  : "Select country first"
              }
              searchPlaceholder={
                cityOptions.length
                  ? "Search cities…"
                  : "Type your city name…"
              }
              allowCustom
            />
          </div>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-semibold text-ink-muted">Currency</span>
            <select
              value={values.currency}
              onChange={(e) => onChange("currency", e.target.value)}
              className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
            >
              <option value="">Select currency</option>
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <OnboardingWhy>
        So every price you see is real: your currency, your shipping, no
        checkout surprises.
      </OnboardingWhy>

      <OnboardingQGroup title="And your usual sizes... if you know them offhand">
        <div className="flex flex-wrap gap-2">
          <select
            value={values.topSize}
            onChange={(e) => onChange("topSize", e.target.value)}
            className="max-w-full rounded-full border border-neutral-200 px-3.5 py-2 text-sm font-semibold outline-none focus:border-brand"
          >
            <option value="">Top: —</option>
            {TOP_SIZE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                Top: {s.label}
              </option>
            ))}
          </select>
          <select
            value={values.bottomSize}
            onChange={(e) => onChange("bottomSize", e.target.value)}
            className="max-w-full rounded-full border border-neutral-200 px-3.5 py-2 text-sm font-semibold outline-none focus:border-brand"
          >
            <option value="">Bottom: —</option>
            {BOTTOM_SIZE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                Bottom: {s.label}
              </option>
            ))}
          </select>
          <select
            value={values.shoeEU}
            onChange={(e) => onChange("shoeEU", e.target.value)}
            className="max-w-full rounded-full border border-neutral-200 px-3.5 py-2 text-sm font-semibold outline-none focus:border-brand"
          >
            <option value="">Shoe: —</option>
            {SHOE_SIZE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                Shoe: {s.label}
              </option>
            ))}
          </select>
        </div>
        <OnboardingWhy>
          Sizes lie from brand to brand... I&apos;ll translate yours into each
          brand&apos;s truth.
        </OnboardingWhy>
      </OnboardingQGroup>
    </section>
  );
}
