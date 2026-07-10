"use client";

import { useMemo } from "react";
import {
  Globe2,
  Heart,
  Ruler,
  ShieldBan,
  Sparkles,
  UserRound,
} from "lucide-react";
import { OnboardingSection } from "@/components/onboarding/OnboardingSection";
import { PillSelect } from "@/components/ui/PillSelect";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { TagInput } from "@/components/ui/TagInput";
import {
  AGE_RANGES,
  BOTTOM_SIZES,
  BRAND_SUGGESTIONS,
  BUDGET_OPTIONS,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  GENDER_OPTIONS,
  HARD_AVOID_SUGGESTIONS,
  SHOE_EU_SIZES,
  STYLE_SUGGESTIONS,
  TOP_SIZES,
  currencyHintForCountry,
} from "@/lib/onboarding/form-options";

export type OnboardingProfileValues = {
  preferredName: string;
  genderPresentation: string;
  ageRange: string;
  shippingCountry: string;
  currency: string;
  topSize: string;
  bottomSize: string;
  shoeEU: string;
  budgetPhilosophy: string;
  styleLikes: string;
  styleAvoids: string;
  brandLikes: string;
  brandAvoids: string;
  hardAvoids: string;
  extraNotes: string;
};

type Props = {
  values: OnboardingProfileValues;
  hasPrefill: boolean;
  onChange: <K extends keyof OnboardingProfileValues>(
    key: K,
    value: OnboardingProfileValues[K],
  ) => void;
};

function progressPercent(values: OnboardingProfileValues): number {
  const required = [
    values.preferredName.trim(),
    values.genderPresentation.trim(),
    values.ageRange.trim(),
  ].filter(Boolean).length;

  const optionalSignals = [
    values.shippingCountry.trim(),
    values.currency.trim(),
    values.topSize.trim() || values.bottomSize.trim() || values.shoeEU.trim(),
    values.budgetPhilosophy.trim() || values.styleLikes.trim(),
    values.brandLikes.trim() || values.brandAvoids.trim() || values.hardAvoids.trim(),
  ].filter(Boolean).length;

  const requiredPct = (required / 3) * 70;
  const optionalPct = (optionalSignals / 5) * 30;
  return Math.min(100, Math.round(requiredPct + optionalPct));
}

export function OnboardingProfileStep({ values, hasPrefill, onChange }: Props) {
  const progress = useMemo(() => progressPercent(values), [values]);

  const requiredDone =
    Boolean(values.preferredName.trim()) &&
    Boolean(values.genderPresentation.trim()) &&
    Boolean(values.ageRange.trim());

  const locationFilled = Boolean(values.shippingCountry.trim() || values.currency.trim());
  const sizingFilled = Boolean(
    values.topSize.trim() || values.bottomSize.trim() || values.shoeEU.trim(),
  );
  const styleFilled = Boolean(
    values.budgetPhilosophy.trim() ||
      values.styleLikes.trim() ||
      values.styleAvoids.trim(),
  );
  const brandsFilled = Boolean(
    values.brandLikes.trim() || values.brandAvoids.trim() || values.hardAvoids.trim(),
  );

  function handleCountryChange(country: string) {
    onChange("shippingCountry", country);
    if (!values.currency.trim()) {
      const hint = currencyHintForCountry(country);
      if (hint) onChange("currency", hint);
    }
  }

  const greeting = values.preferredName.trim()
    ? `Nice to meet you, ${values.preferredName.trim().split(/\s+/)[0]}`
    : "Let's get to know you";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {hasPrefill ? (
          <div className="rounded-2xl border border-success/30 bg-success-bgSoft/80 px-4 py-3.5">
            <p className="text-sm font-medium text-success-dark">
              We filled in what we could from what you pasted
            </p>
            <p className="mt-1 text-xs leading-5 text-success-dark/80">
              Take a quick look below and change anything that&apos;s not quite right. Only three
              things are required to continue.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-brand/15 bg-gradient-to-br from-brand-tint/60 via-white to-surface-tint/50 px-4 py-3.5">
            <p className="text-sm font-medium text-ink">{greeting}</p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              Three quick answers and you&apos;re in. Everything else is optional — but the more
              you share, the better Shoop can help.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-secondary">Your progress</span>
            <span className="tabular-nums text-ink-muted">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-tint">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500 ease-ios"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11px] text-ink-muted">
            {requiredDone
              ? "You're good to go — add more anytime if you'd like."
              : "Just your name, clothing style, and age group to start."}
          </p>
        </div>
      </div>

      <OnboardingSection
        icon={<UserRound className="size-4" aria-hidden />}
        title="About you"
        subtitle="So Shoop knows what to call you and how to find things you'll love."
        defaultOpen
        filled={requiredDone}
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">What should we call you?</span>
          <input
            value={values.preferredName}
            onChange={(e) => onChange("preferredName", e.target.value)}
            autoComplete="given-name"
            placeholder="Your first name or nickname"
            className="w-full rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-brand/40 focus:ring-2 focus:ring-brand/15"
          />
        </label>

        <PillSelect
          label="How do you shop for clothing?"
          value={values.genderPresentation}
          onChange={(v) => onChange("genderPresentation", v)}
          options={GENDER_OPTIONS}
          columns={2}
        />

        <PillSelect
          label="Age group"
          value={values.ageRange}
          onChange={(v) => onChange("ageRange", v)}
          options={AGE_RANGES.map((a) => ({ value: a, label: a }))}
          columns={4}
        />
      </OnboardingSection>

      <OnboardingSection
        icon={<Globe2 className="size-4" aria-hidden />}
        title="Where you shop"
        subtitle="For accurate shipping and prices where you live."
        optional
        defaultOpen={!locationFilled && !hasPrefill}
        filled={locationFilled}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SearchableSelect
            label="Shipping country"
            value={values.shippingCountry}
            onChange={handleCountryChange}
            options={COUNTRY_OPTIONS}
            placeholder="Search your country"
            searchPlaceholder="Type a country name…"
            allowCustom
            optional
          />
          <SearchableSelect
            label="Preferred currency"
            value={values.currency}
            onChange={(v) => onChange("currency", v)}
            options={CURRENCY_OPTIONS.map((c) => ({
              value: c.value,
              label: c.label,
              hint: c.value,
            }))}
            placeholder="Search currency"
            searchPlaceholder="Search for your currency…"
            allowCustom
            optional
          />
        </div>
      </OnboardingSection>

      <OnboardingSection
        icon={<Ruler className="size-4" aria-hidden />}
        title="Your fit"
        subtitle="So we get your sizes right from the start."
        optional
        defaultOpen={sizingFilled}
        filled={sizingFilled}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <SearchableSelect
            label="Usual top size"
            value={values.topSize}
            onChange={(v) => onChange("topSize", v)}
            options={TOP_SIZES.map((s) => ({ value: s, label: s }))}
            placeholder="e.g. M"
            allowCustom
            optional
          />
          <SearchableSelect
            label="Usual bottom size"
            value={values.bottomSize}
            onChange={(v) => onChange("bottomSize", v)}
            options={BOTTOM_SIZES.map((s) => ({ value: s, label: s }))}
            placeholder="e.g. 32x30"
            allowCustom
            optional
          />
          <SearchableSelect
            label="EU shoe size"
            value={values.shoeEU}
            onChange={(v) => onChange("shoeEU", v)}
            options={SHOE_EU_SIZES.map((s) => ({ value: s, label: s }))}
            placeholder="e.g. 42"
            allowCustom
            optional
          />
        </div>
      </OnboardingSection>

      <OnboardingSection
        icon={<Sparkles className="size-4" aria-hidden />}
        title="Your vibe"
        subtitle="Help us understand what you like to wear."
        optional
        defaultOpen={styleFilled}
        filled={styleFilled}
      >
        <PillSelect
          label="How do you like to spend?"
          value={values.budgetPhilosophy}
          onChange={(v) => onChange("budgetPhilosophy", v)}
          options={BUDGET_OPTIONS}
          columns={2}
          optional
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TagInput
            label="Styles you love"
            value={values.styleLikes}
            onChange={(v) => onChange("styleLikes", v)}
            placeholder="e.g. minimal, clean lines"
            suggestions={STYLE_SUGGESTIONS}
            optional
          />
          <TagInput
            label="Styles to skip"
            value={values.styleAvoids}
            onChange={(v) => onChange("styleAvoids", v)}
            placeholder="e.g. loud logos, chunky"
            suggestions={["loud logos", "chunky", "neon", "distressed", "logo-heavy"]}
            optional
          />
        </div>
      </OnboardingSection>

      <OnboardingSection
        icon={<Heart className="size-4" aria-hidden />}
        title="Brands & boundaries"
        subtitle="Brands you reach for — and things you'd never buy."
        optional
        defaultOpen={brandsFilled}
        filled={brandsFilled}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TagInput
            label="Brands you love"
            value={values.brandLikes}
            onChange={(v) => onChange("brandLikes", v)}
            placeholder="Add a brand"
            suggestions={BRAND_SUGGESTIONS}
            optional
          />
          <TagInput
            label="Brands you avoid"
            value={values.brandAvoids}
            onChange={(v) => onChange("brandAvoids", v)}
            placeholder="Add a brand"
            suggestions={["Shein", "Temu", "Fast fashion"]}
            optional
          />
        </div>

        <TagInput
          label="Hard no's"
          value={values.hardAvoids}
          onChange={(v) => onChange("hardAvoids", v)}
          placeholder="Materials, ethics, allergens…"
          suggestions={HARD_AVOID_SUGGESTIONS}
          optional
        />
      </OnboardingSection>

      <OnboardingSection
        icon={<ShieldBan className="size-4" aria-hidden />}
        title="Anything else?"
        subtitle="Things you already own, people you shop for, or what you're looking for right now."
        optional
        defaultOpen={Boolean(values.extraNotes.trim())}
        filled={Boolean(values.extraNotes.trim())}
      >
        <textarea
          value={values.extraNotes}
          onChange={(e) => onChange("extraNotes", e.target.value)}
          rows={3}
          placeholder="For example: I have a Rimowa carry-on, looking for a wedding outfit, my partner wears size L…"
          className="w-full resize-y rounded-xl border border-hairline bg-white px-3.5 py-3 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-brand/40 focus:ring-2 focus:ring-brand/15"
        />
      </OnboardingSection>
    </div>
  );
}
