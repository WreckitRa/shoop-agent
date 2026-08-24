"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FittingCta,
  FittingKick,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
import { LEGAL_PATHS } from "@/lib/legal/constants";
import { openAuthModal } from "@/hooks/useGuestMode";

export function FittingAccountRequired({ onSkip }: { onSkip: () => void }) {
  return (
    <section>
      <FittingKick>THE SCAN · ACCOUNT</FittingKick>
      <FittingTitle
        lines={[
          { text: "A face photo" },
          { text: "needs an %%account.%%", red: true },
        ]}
      />
      <FittingWhisper>
        We only process a photograph after you create an account, give your date
        of birth, and accept a separate biometric consent. You can skip the
        photo and keep going with typed facts.
      </FittingWhisper>
      <div className="mt-6 flex flex-wrap gap-3">
        <FittingCta onClick={() => openAuthModal("signup")}>
          Create an account
        </FittingCta>
        <button
          type="button"
          onClick={onSkip}
          className="border-0 border-b border-[var(--fitting-line)] bg-transparent pb-0.5 text-[12.5px] font-semibold text-[var(--fitting-quiet)]"
        >
          skip... continue without a photo
        </button>
      </div>
    </section>
  );
}

export function FittingBiometricConsent({
  onAccept,
  onSkip,
  busy,
  skipLabel = "skip... continue without a photo",
}: {
  onAccept: () => Promise<void> | void;
  onSkip: () => void;
  busy?: boolean;
  skipLabel?: string;
}) {
  const [ticked, setTicked] = useState(false);

  return (
    <section>
      <FittingKick>THE SCAN · CONSENT</FittingKick>
      <FittingTitle
        lines={[
          { text: "This is a" },
          { text: "%%separate%% yes.", red: true },
        ]}
      />
      <FittingWhisper>
        Shoop measures you from one face photograph. We never ask for a body
        photo. The image is deleted after extraction. Full terms in the{" "}
        <Link
          href={LEGAL_PATHS.biometric}
          target="_blank"
          className="font-semibold text-[var(--fitting-ink)] underline underline-offset-2"
        >
          Biometric Consent
        </Link>
        .
      </FittingWhisper>
      <ul className="mt-5 max-w-[520px] list-disc space-y-2 pl-5 text-[13.5px] leading-[1.55] text-[#3A3A44]">
        <li>Face photograph only — body traits are inferred and correctable in Settings.</li>
        <li>Used to style you and render garments on your twin. Nothing else.</li>
        <li>Withdraw anytime in Settings. That deletes the twin; the account stays.</li>
      </ul>
      <label className="mt-6 flex max-w-[520px] cursor-pointer items-start gap-3 rounded-[16px] border border-[var(--fitting-line)] bg-white px-4 py-3.5">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          className="mt-1 size-4 shrink-0"
        />
        <span className="text-[13.5px] leading-[1.5] text-[var(--fitting-ink)]">
          I agree to Shoop measuring me from my photograph, as described in the
          Biometric Consent. I am at least 13, and the photo is of me.
        </span>
      </label>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <FittingCta
          disabled={!ticked || busy}
          onClick={() => void onAccept()}
        >
          {busy ? "Saving…" : "Continue to photo"}
        </FittingCta>
        <button
          type="button"
          onClick={onSkip}
          className="border-0 border-b border-[var(--fitting-line)] bg-transparent pb-0.5 text-[12.5px] font-semibold text-[var(--fitting-quiet)]"
        >
          {skipLabel}
        </button>
      </div>
    </section>
  );
}
