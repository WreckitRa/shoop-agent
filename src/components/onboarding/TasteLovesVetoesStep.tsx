"use client";

import { useState } from "react";
import {
  OnboardingChip,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";
import {
  suggestBrandAvoids,
  suggestBrandLikes,
  suggestStyleVetoes,
  type LovesVetoesContext,
} from "@/lib/onboarding/loves-vetoes-suggest";

type Props = {
  context: LovesVetoesContext;
  brandLikes: string[];
  brandAvoids: string[];
  hardAvoids: string[];
  onChangeBrandLikes: (values: string[]) => void;
  onChangeBrandAvoids: (values: string[]) => void;
  onChangeHardAvoids: (values: string[]) => void;
};

function toggle(list: string[], value: string): string[] {
  const set = new Set(list);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

export function TasteLovesVetoesStep({
  context,
  brandLikes,
  brandAvoids,
  hardAvoids,
  onChangeBrandLikes,
  onChangeBrandAvoids,
  onChangeHardAvoids,
}: Props) {
  const [customBrand, setCustomBrand] = useState("");
  const [customAvoidBrand, setCustomAvoidBrand] = useState("");
  const [customVeto, setCustomVeto] = useState("");

  const brandSuggestions = suggestBrandLikes(context, 8);
  const vetoSuggestions = suggestStyleVetoes(context, 8);
  const avoidBrandSuggestions = suggestBrandAvoids(context, 6);

  const brandSuggestionSet = new Set(
    brandSuggestions.map((b) => b.toLowerCase()),
  );
  const vetoSuggestionSet = new Set(
    vetoSuggestions.map((v) => v.toLowerCase()),
  );
  const avoidSuggestionSet = new Set(
    avoidBrandSuggestions.map((b) => b.toLowerCase()),
  );

  return (
    <section className="space-y-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-[13.5px] font-semibold">
            Brands you reach for
          </h4>
          <p className="mb-2 text-[11px] text-neutral-400">
            Suggested from how you shop and what you picked earlier
          </p>
          <div className="flex flex-wrap gap-2">
            {brandSuggestions.map((brand) => (
              <OnboardingChip
                key={brand}
                selected={brandLikes.includes(brand)}
                onClick={() => onChangeBrandLikes(toggle(brandLikes, brand))}
              >
                {brand}
              </OnboardingChip>
            ))}
            {brandLikes
              .filter((b) => !brandSuggestionSet.has(b.toLowerCase()))
              .map((brand) => (
                <OnboardingChip
                  key={brand}
                  selected
                  onClick={() => onChangeBrandLikes(toggle(brandLikes, brand))}
                >
                  {brand}
                </OnboardingChip>
              ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = customBrand.trim();
              if (!v) return;
              onChangeBrandLikes(toggle(brandLikes, v));
              setCustomBrand("");
            }}
          >
            <input
              value={customBrand}
              onChange={(e) => setCustomBrand(e.target.value)}
              placeholder="+ add a brand"
              className="flex-1 rounded-full border border-dashed border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </form>
        </div>

        <div>
          <h4 className="mb-2 text-[13.5px] font-semibold">
            Never put me in...
          </h4>
          <p className="mb-2 text-[11px] text-neutral-400">
            Based on your looks and spend style — edit freely
          </p>
          <div className="flex flex-wrap gap-2">
            {vetoSuggestions.map((veto) => (
              <OnboardingChip
                key={veto}
                selected={hardAvoids.includes(veto)}
                onClick={() => onChangeHardAvoids(toggle(hardAvoids, veto))}
              >
                {veto}
              </OnboardingChip>
            ))}
            {hardAvoids
              .filter((v) => !vetoSuggestionSet.has(v.toLowerCase()))
              .map((veto) => (
                <OnboardingChip
                  key={veto}
                  selected
                  onClick={() => onChangeHardAvoids(toggle(hardAvoids, veto))}
                >
                  {veto}
                </OnboardingChip>
              ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = customVeto.trim();
              if (!v) return;
              onChangeHardAvoids(toggle(hardAvoids, v));
              setCustomVeto("");
            }}
          >
            <input
              value={customVeto}
              onChange={(e) => setCustomVeto(e.target.value)}
              placeholder="+ your own"
              className="flex-1 rounded-full border border-dashed border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </form>

          <h4 className="mb-2 mt-3 text-[13.5px] font-semibold">
            Brands you avoid
          </h4>
          <div className="flex flex-wrap gap-2">
            {avoidBrandSuggestions.map((brand) => (
              <OnboardingChip
                key={brand}
                selected={brandAvoids.includes(brand)}
                onClick={() =>
                  onChangeBrandAvoids(toggle(brandAvoids, brand))
                }
              >
                {brand}
              </OnboardingChip>
            ))}
            {brandAvoids
              .filter((b) => !avoidSuggestionSet.has(b.toLowerCase()))
              .map((brand) => (
                <OnboardingChip
                  key={brand}
                  selected
                  onClick={() =>
                    onChangeBrandAvoids(toggle(brandAvoids, brand))
                  }
                >
                  {brand}
                </OnboardingChip>
              ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = customAvoidBrand.trim();
              if (!v) return;
              onChangeBrandAvoids(toggle(brandAvoids, v));
              setCustomAvoidBrand("");
            }}
          >
            <input
              value={customAvoidBrand}
              onChange={(e) => setCustomAvoidBrand(e.target.value)}
              placeholder="+ add a brand"
              className="flex-1 rounded-full border border-dashed border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </form>
        </div>
      </div>

      <OnboardingWhy>
        The no-list is sacred. Whatever lands here, you&apos;ll never see me
        suggest it... and you can edit it anytime.
      </OnboardingWhy>
    </section>
  );
}
