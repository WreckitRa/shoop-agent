"use client";

import { useCallback, useEffect, useState } from "react";
import { flushGuestChatStateForMigration } from "@/components/chat/chat-store";
import {
  isGuestAccess,
  useAppSessionStore,
} from "@/lib/client/app-session";
import {
  guestHasPersistedData,
  isGuestSessionActive,
  startGuestSessionAsync,
} from "@/lib/client/guest-storage";

export function useGuestMode() {
  const mode = useAppSessionStore((s) => s.mode);

  const continueAsGuest = useCallback(() => {
    useAppSessionStore.getState().setGuest();
    void startGuestSessionAsync();
  }, []);

  return {
    isGuest: isGuestAccess(mode),
    continueAsGuest,
  };
}

export function openAuthModal(mode: "login" | "signup" = "signup") {
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
