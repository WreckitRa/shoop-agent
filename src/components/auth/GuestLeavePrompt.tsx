"use client";

import { useEffect, useRef } from "react";
import {
  isGuestPhotoLive,
  shouldPurgeGuestPhotoOnUnload,
} from "@/lib/client/guest-photo-abandon";
import { isGuestSessionActive } from "@/lib/client/guest-storage";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useAppSessionStore } from "@/lib/client/app-session";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { readOnboardingUiSession } from "@/components/onboarding/fitting/ui-session";
import { clearPendingFittingPhoto } from "@/components/onboarding/fitting/pending-photo";
import {
  ONBOARDING_LEAVE_UNLOAD_MESSAGE,
  guestNeedsOnboardingLeaveWarning,
} from "@/components/onboarding/fitting/leave-warning";

const LEAVE_MESSAGE =
  "You might lose your cart, chats, and personalized picks if you leave or clear browser data. Sign up to save your progress on any device.";

const PHOTO_LEAVE_MESSAGE =
  "If you leave without saving an account, we will delete the photograph and the measurements from this visit.";

/**
 * Warns guest users before closing. If they accepted photo consent and never
 * claimed an account, delete that photograph and the measurements.
 */
export function GuestLeavePrompt() {
  const armedRef = useRef(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!armedRef.current) return;
      const fitting = useInlineFittingStore.getState();
      const onboardingLeave = guestNeedsOnboardingLeaveWarning({
        accessMode: useAppSessionStore.getState().mode,
        columnOpen: fitting.columnOpen,
        onboardingActive: fitting.onboardingActive,
      });
      const message = onboardingLeave
        ? ONBOARDING_LEAVE_UNLOAD_MESSAGE
        : isGuestPhotoLive()
          ? PHOTO_LEAVE_MESSAGE
          : LEAVE_MESSAGE;
      e.preventDefault();
      e.returnValue = message;
      return message;
    };

    const handlePageHide = (e: PageTransitionEvent) => {
      if (!armedRef.current) return;
      const session = readOnboardingUiSession();
      if (
        !shouldPurgeGuestPhotoOnUnload({
          persisted: e.persisted,
          hasUiSession: Boolean(session),
          sessionDismissed: session?.dismissed,
        })
      ) {
        return;
      }
      clearPendingFittingPhoto();
      void guestFetch("/api/privacy/guest-abandon", {
        method: "POST",
        credentials: "include",
        keepalive: true,
      });
    };

    const syncArmed = () => {
      armedRef.current = isGuestSessionActive();
    };

    syncArmed();
    window.addEventListener("shoop-guest-changed", syncArmed);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("shoop-guest-changed", syncArmed);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  return null;
}
