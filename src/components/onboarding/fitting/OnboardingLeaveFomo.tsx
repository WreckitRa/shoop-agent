"use client";

import { useEffect } from "react";
import { openAuthModal } from "@/hooks/useGuestMode";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { FittingCta, FittingKick } from "@/components/onboarding/onboarding-ui";
import { clearPendingFittingPhoto } from "@/components/onboarding/fitting/pending-photo";
import { guestFetch } from "@/lib/client/guest-fetch";
import { clearGuestPhotoLive } from "@/lib/client/guest-photo-abandon";

/** In-app FOMO when a guest tries to close The Fitting before signing up. */
export function OnboardingLeaveFomo() {
  const open = useInlineFittingStore((s) => s.pendingLeave);
  const cancelLeave = useInlineFittingStore((s) => s.cancelLeave);
  const confirmLeave = useInlineFittingStore((s) => s.confirmLeave);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancelLeave]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-[rgba(14,14,17,0.45)] p-4 backdrop-blur-md sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="onboarding-leave-title"
      aria-describedby="onboarding-leave-desc"
    >
      <button
        type="button"
        aria-label="Stay in The Fitting"
        className="absolute inset-0"
        onClick={cancelLeave}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-[20px] border-2 border-[var(--fitting-ink)] bg-white p-0 shadow-[0_0_100px_-40px_rgba(26,26,46,.45)] sm:p-0">
        <div className="bg-[var(--fitting-ink)] px-6 py-5 text-white">
          <FittingKick>
            <span className="text-[#FF8A90]">STILL ON THE HANGER</span>
          </FittingKick>
          <h2
            id="onboarding-leave-title"
            className="max-w-[22rem] font-display text-[25px] font-black leading-[1.1] tracking-[-0.035em]"
          >
            Walk away and this fitting isn&apos;t yours yet.
          </h2>
        </div>
        <div className="p-6 sm:p-7">
        <p
          id="onboarding-leave-desc"
          className="max-w-[28rem] text-[14px] leading-[1.66] text-[var(--fitting-quiet)] [&_b]:font-semibold [&_b]:text-[var(--fitting-ink)]"
        >
          The twin, the scan, and the clothes that already work on you live in
          this browser. No account — they don&apos;t come with you. Leave
          without saving and we delete the photograph and the measurements, as
          you asked.
        </p>
        <div className="mt-6 flex flex-col items-start gap-4">
          <FittingCta
            onClick={() => {
              cancelLeave();
              openAuthModal("signup");
            }}
          >
            Save my progress
          </FittingCta>
          <button
            type="button"
            onClick={cancelLeave}
            className="border-0 bg-transparent p-0 font-sans text-[12.5px] font-bold text-[var(--fitting-ink)] hover:text-[var(--fitting-red)]"
          >
            Stay in The Fitting
          </button>
          <button
            type="button"
            onClick={() => {
              clearPendingFittingPhoto();
              clearGuestPhotoLive();
              void guestFetch("/api/privacy/guest-abandon", {
                method: "POST",
                keepalive: true,
              });
              confirmLeave();
            }}
            className="border-0 border-b border-[var(--fitting-line)] bg-transparent pb-0.5 font-sans text-[12.5px] font-semibold text-[var(--fitting-quiet)]"
          >
            Leave anyway
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
