"use client";

import {
  FittingCta,
  FittingKick,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
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
