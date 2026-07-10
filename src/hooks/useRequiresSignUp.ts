"use client";

import { useCallback } from "react";
import { useAppSessionStore } from "@/lib/client/app-session";
import { openAuthModal } from "@/hooks/useGuestMode";

/** Guests have full app access; use `promptSignUp` only for optional save-your-progress CTAs. */
export function useRequiresSignUp() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const isGuest = accessMode === "guest";

  const promptSignUp = useCallback(() => {
    openAuthModal("signup");
  }, []);

  return { isGuest, requiresSignUp: false, promptSignUp };
}
