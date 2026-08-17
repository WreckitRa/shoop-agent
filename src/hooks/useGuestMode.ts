"use client";

import { useCallback, useEffect, useState } from "react";
import { flushGuestChatStateForMigration } from "@/components/chat/chat-store";
import {
  getInlineFittingSlot,
  useInlineFittingStore,
} from "@/components/onboarding/inline-fitting-store";
import {
  guestHasPersistedData,
  isGuestSessionActive,
  startGuestSessionAsync,
} from "@/lib/client/guest-storage";

export function useGuestMode() {
  const [active, setActive] = useState(false);

  const refresh = useCallback(() => {
    setActive(isGuestSessionActive());
  }, []);

  useEffect(() => {
    refresh();
    const onGuestChanged = () => refresh();
    window.addEventListener("shoop-guest-changed", onGuestChanged);
    return () => window.removeEventListener("shoop-guest-changed", onGuestChanged);
  }, [refresh]);

  const continueAsGuest = useCallback(() => {
    void startGuestSessionAsync().then(() => refresh());
  }, [refresh]);

  return { isGuest: active, continueAsGuest, refresh };
}

export function openAuthModal(mode: "login" | "signup" = "signup") {
  if (getInlineFittingSlot()) {
    useInlineFittingStore.getState().openColumn();
  }
  window.dispatchEvent(
    new CustomEvent("shoop-open-auth", { detail: { mode } }),
  );
}

/** True when the guest session has chats or messages worth saving or losing. */
export function useGuestHasPersistedData(enabled = true) {
  const { isGuest } = useGuestMode();
  const [hasData, setHasData] = useState(false);

  const refresh = useCallback(() => {
    if (!isGuestSessionActive()) {
      setHasData(false);
      return;
    }
    flushGuestChatStateForMigration();
    setHasData(guestHasPersistedData());
  }, []);

  useEffect(() => {
    if (!enabled || !isGuest) {
      setHasData(false);
      return;
    }
    refresh();
    window.addEventListener("shoop-guest-changed", refresh);
    return () => window.removeEventListener("shoop-guest-changed", refresh);
  }, [enabled, isGuest, refresh]);

  return hasData;
}
