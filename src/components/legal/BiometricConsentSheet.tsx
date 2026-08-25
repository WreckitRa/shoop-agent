"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/legal/constants";

export const BIOMETRIC_CONSENT_EVENT = "shoop-biometric-consent";

export function notifyBiometricConsent(accepted: boolean) {
  window.dispatchEvent(
    new CustomEvent(BIOMETRIC_CONSENT_EVENT, { detail: { accepted } }),
  );
}

const btnClass =
  "h-10 min-w-[140px] rounded-[12px] border border-[#D6D6DE] bg-white px-4 text-[12.5px] font-extrabold text-[var(--fitting-ink)] disabled:opacity-40";

export function BiometricConsentSheet({
  busy,
  error,
  acceptLabel = "Continue to photo",
  skipLabel,
  onAccept,
  onSkip,
}: {
  busy?: boolean;
  error?: string | null;
  acceptLabel?: string;
  skipLabel: string;
  onAccept: () => void;
  onSkip: () => void;
}) {
  const [ticked, setTicked] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] p-4">
      <div className="pointer-events-auto mx-auto max-h-[min(85dvh,560px)] max-w-[640px] overflow-y-auto rounded-[20px] border border-[var(--fitting-line)] bg-white p-4 shadow-[0_18px_40px_-18px_rgba(14,14,17,0.45)]">
        <p className="text-[11px] font-extrabold tracking-[0.14em] text-[var(--fitting-quiet)]">
          THE SCAN · CONSENT
        </p>
        <p className="mt-1 text-[15px] font-extrabold text-[var(--fitting-ink)]">
          This is a separate yes.
        </p>
        <p className="mt-2 text-[13px] leading-[1.5] text-[#3A3A44]">
          Shoop measures you from one face photograph. We never ask for a body
          photo. The image is deleted after extraction. Full terms in the{" "}
          <Link
            href={LEGAL_PATHS.biometric}
            className="font-semibold text-[var(--fitting-ink)] underline underline-offset-2"
          >
            Biometric Consent
          </Link>
          .
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[12.5px] leading-[1.45] text-[#3A3A44]">
          <li>
            Face photograph only — body traits are inferred and correctable in
            Settings.
          </li>
          <li>Used to style you and render garments on your twin. Nothing else.</li>
          <li>
            Withdraw anytime in Settings. That deletes the twin; the account
            stays.
          </li>
        </ul>
        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-[14px] border border-[var(--fitting-line)] bg-[#FAFAFB] px-3 py-2.5">
          <input
            type="checkbox"
            checked={ticked}
            onChange={(e) => setTicked(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-[12.5px] leading-[1.45] text-[var(--fitting-ink)]">
            I agree to Shoop measuring me from my photograph, as described in
            the Biometric Consent. I am at least 13, and the photo is of me.
          </span>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnClass}
            disabled={!ticked || busy}
            onClick={onAccept}
          >
            {busy ? "Saving…" : acceptLabel}
          </button>
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={onSkip}
          >
            {skipLabel}
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-[12.5px] font-semibold text-[var(--fitting-red)]">
            {error}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
