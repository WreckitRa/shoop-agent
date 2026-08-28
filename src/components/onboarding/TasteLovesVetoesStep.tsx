"use client";

import {
  FittingAddIn,
  FittingCounted,
  FittingKick,
  FittingMulti,
  FittingNavRow,
  FittingPromise,
  FittingQlbl,
  FittingTitle,
  FittingWhisper,
  OnboardingChip,
} from "@/components/onboarding/onboarding-ui";
import {
  suggestBrandAvoids,
  suggestBrandLikes,
  suggestComfortLines,
  suggestStyleVetoes,
  type LovesVetoesContext,
} from "@/lib/onboarding/loves-vetoes-suggest";

type Props = {
  context: LovesVetoesContext;
  brandLikes: string[];
  brandAvoids: string[];
  hardAvoids: string[];
  comfort: string[];
  onChangeBrandLikes: (values: string[]) => void;
  onChangeBrandAvoids: (values: string[]) => void;
  onChangeHardAvoids: (values: string[]) => void;
  onChangeComfort: (values: string[]) => void;
  onContinue?: () => void;
  busy?: boolean;
};

function toggle(list: string[], value: string): string[] {
  const set = new Set(list);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

function withoutBrand(list: string[], brand: string): string[] {
  const key = brand.trim().toLowerCase();
  return list.filter((b) => b.trim().toLowerCase() !== key);
}

function hasBrand(list: string[], brand: string): boolean {
  const key = brand.trim().toLowerCase();
  return list.some((b) => b.trim().toLowerCase() === key);
}

export function TasteLovesVetoesStep({
  context,
  brandLikes,
  brandAvoids,
  hardAvoids,
  comfort,
  onChangeBrandLikes,
  onChangeBrandAvoids,
  onChangeHardAvoids,
  onChangeComfort,
  onContinue,
  busy,
}: Props) {
  const brandSuggestions = suggestBrandLikes(context, 8);
  const vetoSuggestions = suggestStyleVetoes(context, 8);
  const comfortSuggestions = suggestComfortLines(context);
  const avoidBrandSuggestions = suggestBrandAvoids(context, 6).filter(
    (brand) => !hasBrand(brandLikes, brand),
  );

  const brandSuggestionSet = new Set(
    brandSuggestions.map((b) => b.toLowerCase()),
  );
  const vetoSuggestionSet = new Set(
    vetoSuggestions.map((v) => v.toLowerCase()),
  );
  const comfortOptionSet = new Set(
    comfortSuggestions.map((o) => o.value.toLowerCase()),
  );
  const avoidSuggestionSet = new Set(
    avoidBrandSuggestions.map((b) => b.toLowerCase()),
  );

  function toggleBrandLike(brand: string) {
    const next = toggle(brandLikes, brand);
    onChangeBrandLikes(next);
    if (hasBrand(next, brand)) {
      onChangeBrandAvoids(withoutBrand(brandAvoids, brand));
    }
  }

  function toggleBrandAvoid(brand: string) {
    if (!hasBrand(brandAvoids, brand) && hasBrand(brandLikes, brand)) {
      return;
    }
    const next = toggle(brandAvoids, brand);
    onChangeBrandAvoids(next);
    if (hasBrand(next, brand)) {
      onChangeBrandLikes(withoutBrand(brandLikes, brand));
    }
  }

  return (
    <section>
      <FittingKick>EVIDENCE · THE NO-LIST</FittingKick>
      <FittingTitle
        lines={[
          { text: "Quick vetoes" },
          { text: "and loyalties%%.%%", red: true },
        ]}
      />
      <FittingWhisper>
        The no-list is sacred... whatever lands here, you&apos;ll never see me
        suggest it.
      </FittingWhisper>
      <FittingPromise>
        <b>This is a promise, not a preference.</b> Whatever lands here I will
        never show you again and never try to talk you into. Not with a
        discount, not with a good reason, not ever.{" "}
        <b>You will not have to say it twice.</b>
      </FittingPromise>
      <FittingMulti />

      <FittingQlbl>Brands you reach for</FittingQlbl>
      <p className="mb-2.5 -mt-1.5 text-[11px] font-medium text-[var(--fitting-quiet)]">
        suggested from how you shop and what you picked earlier
      </p>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {brandSuggestions.map((brand) => (
          <OnboardingChip
            key={brand}
            variant="love"
            selected={hasBrand(brandLikes, brand)}
            onClick={() => toggleBrandLike(brand)}
          >
            {brand}
          </OnboardingChip>
        ))}
        {brandLikes
          .filter((b) => !brandSuggestionSet.has(b.toLowerCase()))
          .map((brand) => (
            <OnboardingChip
              key={brand}
              variant="love"
              selected
              onClick={() => toggleBrandLike(brand)}
            >
              {brand}
            </OnboardingChip>
          ))}
        <FittingAddIn
          placeholder="+ add a brand"
          onSubmit={(v) => toggleBrandLike(v)}
        />
      </div>

      <div className="mt-9 border-t border-dashed border-[var(--fitting-g3)] pt-7">
        <FittingQlbl>Comfort lines I won&apos;t cross</FittingQlbl>
        <p className="mb-2.5 -mt-1.5 text-[11px] font-medium text-[var(--fitting-quiet)]">
          hard filters... I never score my way around these
        </p>
        <div className="flex max-w-[660px] flex-wrap gap-2.5">
          {comfortSuggestions.map((opt) => (
            <OnboardingChip
              key={opt.value}
              variant="no"
              selected={comfort.includes(opt.value)}
              onClick={() => onChangeComfort(toggle(comfort, opt.value))}
            >
              {opt.label}
            </OnboardingChip>
          ))}
          {comfort
            .filter((v) => !comfortOptionSet.has(v.toLowerCase()))
            .map((item) => (
              <OnboardingChip
                key={item}
                variant="no"
                selected
                onClick={() => onChangeComfort(toggle(comfort, item))}
              >
                {item}
              </OnboardingChip>
            ))}
          <FittingAddIn
            placeholder="+ your own"
            danger
            onSubmit={(v) => onChangeComfort(toggle(comfort, v))}
          />
        </div>
      </div>

      <div className="mt-9 border-t border-dashed border-[var(--fitting-g3)] pt-7">
        <FittingQlbl>Never put me in...</FittingQlbl>
        <p className="mb-2.5 -mt-1.5 text-[11px] font-medium text-[var(--fitting-quiet)]">
          suggested from your looks and spend style... edit freely, or type
          your own
        </p>
        <div className="flex max-w-[660px] flex-wrap gap-2.5">
          {vetoSuggestions.map((veto) => (
            <OnboardingChip
              key={veto}
              variant="no"
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
                variant="no"
                selected
                onClick={() => onChangeHardAvoids(toggle(hardAvoids, veto))}
              >
                {veto}
              </OnboardingChip>
            ))}
          <FittingAddIn
            placeholder="+ your own"
            danger
            onSubmit={(v) => onChangeHardAvoids(toggle(hardAvoids, v))}
          />
        </div>
      </div>

      <FittingQlbl>Brands you avoid</FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {avoidBrandSuggestions.map((brand) => (
          <OnboardingChip
            key={brand}
            variant="no"
            selected={hasBrand(brandAvoids, brand)}
            onClick={() => toggleBrandAvoid(brand)}
          >
            {brand}
          </OnboardingChip>
        ))}
        {brandAvoids
          .filter(
            (b) =>
              !avoidSuggestionSet.has(b.toLowerCase()) && !hasBrand(brandLikes, b),
          )
          .map((brand) => (
            <OnboardingChip
              key={brand}
              variant="no"
              selected
              onClick={() => toggleBrandAvoid(brand)}
            >
              {brand}
            </OnboardingChip>
          ))}
        <FittingAddIn
          placeholder="+ add a brand"
          danger
          onSubmit={(v) => {
            if (hasBrand(brandLikes, v)) return;
            toggleBrandAvoid(v);
          }}
        />
      </div>

      {hardAvoids.length + comfort.length + brandAvoids.length > 0 ? (
        <FittingCounted
          title={`Noted. ${hardAvoids.length + comfort.length + brandAvoids.length} things you will never see.`}
        >
          {[...hardAvoids, ...comfort, ...brandAvoids].join(" · ")}
          <br />
          <br />
          They are filters now, not preferences. Nothing from here on can
          contain any of them, whatever it scores on everything else.
        </FittingCounted>
      ) : null}

      {onContinue ? (
        <FittingNavRow onNext={onContinue} busy={busy} />
      ) : null}
    </section>
  );
}
