"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FittingCta,
  FittingKick,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
import { MIN_ACCOUNT_AGE, LEGAL_PATHS } from "@/lib/legal/constants";

type Props = {
  guest: boolean;
  busy?: boolean;
  error?: string | null;
  onContinue: (ticks: {
    ageAttested: boolean;
    ownPhotoAttested: boolean;
    abandonDeleteAck: boolean;
  }) => void;
};

export function FittingConsentStep({
  guest,
  busy,
  error,
  onContinue,
}: Props) {
  const [age, setAge] = useState(false);
  const [own, setOwn] = useState(false);
  const [leave, setLeave] = useState(false);
  const ready = age && own && (!guest || leave);

  return (
    <section>
      <FittingKick>BEFORE WE START</FittingKick>
      <FittingTitle
        lines={[
          { text: "Three yeses" },
          { text: "before a %%photo.%%", red: true },
        ]}
      />
      <FittingWhisper>
        We measure you from one face photograph. No account yet — save at the
        end if you want to keep this. Full terms in the{" "}
        <Link
          href={LEGAL_PATHS.biometric}
          className="font-semibold text-[var(--fitting-ink)] underline underline-offset-2"
        >
          Biometric Consent
        </Link>
        .
      </FittingWhisper>

      <div className="flex max-w-[520px] flex-col gap-2.5">
        <Tick
          checked={age}
          onChange={setAge}
          label={`I am at least ${MIN_ACCOUNT_AGE} years old.`}
        />
        <Tick
          checked={own}
          onChange={setOwn}
          label="The photograph is of me. I agree to Shoop measuring me from it, as described in the Biometric Consent."
        />
        {guest ? (
          <Tick
            checked={leave}
            onChange={setLeave}
            label="If I leave without saving an account, delete this photograph and the measurements."
          />
        ) : null}
      </div>

      <div className="fitting-nav max-lg:fixed max-lg:inset-x-[22px] max-lg:bottom-[calc(20px+env(safe-area-inset-bottom,0px))] max-lg:z-[8] max-lg:mt-0 max-lg:bg-transparent sticky bottom-0 z-[4] mt-8 bg-white pt-5 lg:relative lg:bg-gradient-to-t lg:from-white lg:via-white/95 lg:to-transparent lg:pt-6">
        <FittingCta
          disabled={!ready || busy}
          onClick={() =>
            onContinue({
              ageAttested: age,
              ownPhotoAttested: own,
              abandonDeleteAck: guest ? leave : false,
            })
          }
        >
          {busy ? "Saving…" : "Next"}
        </FittingCta>
      </div>
      {error ? (
        <p className="mt-3 max-w-lg text-[12.5px] font-semibold text-[var(--fitting-red)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Tick({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2.5 lg:rounded-2xl lg:border-2 lg:border-[var(--fitting-line)] lg:bg-white lg:px-3.5 lg:py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--fitting-ink)]"
      />
      <span className="text-[13px] leading-[1.5] text-[var(--fitting-ink)]">
        {label}
      </span>
    </label>
  );
}
