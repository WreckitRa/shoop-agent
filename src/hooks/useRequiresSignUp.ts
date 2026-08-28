"use client";

import { useCallback } from "react";
import { isGuestAccess, useAppSessionStore } from "@/lib/client/app-session";
import { openAuthModal } from "@/hooks/useGuestMode";

/** Guests have full app access; use `promptSignUp` only for optional save-your-progress CTAs. */
export function useRequiresSignUp() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const isGuest = isGuestAccess(accessMode);

  const promptSignUp = useCallback(() => {
    openAuthModal("signup");
  }, []);

  return { isGuest, requiresSignUp: false, promptSignUp };
}
