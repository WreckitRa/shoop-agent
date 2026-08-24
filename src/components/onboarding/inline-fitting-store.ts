"use client";

import { create } from "zustand";

export const INLINE_FITTING_SLOT_ID = "shoop-inline-fitting";
export const INLINE_FITTING_CARD_SLOT_ID = "shoop-inline-fitting-card";

type InlineFittingState = {
  columnOpen: boolean;
  onboardingActive: boolean;
  /** User closed the column — don't auto-reopen or fall back to fullscreen. */
  columnDismissed: boolean;
  /** Re-open The Fitting after onboarding is already complete (create/update twin). */
  replayFitting: boolean;
  openColumn: () => void;
  closeColumn: () => void;
  dismissColumn: () => void;
  clearReplay: () => void;
  setOnboardingActive: (active: boolean) => void;
};

export const useInlineFittingStore = create<InlineFittingState>((set) => ({
  columnOpen: false,
  onboardingActive: false,
  columnDismissed: false,
  replayFitting: false,
  openColumn: () => {
    set({
      columnOpen: true,
      columnDismissed: false,
      replayFitting: true,
    });
    void import("@/components/chat/chat-store").then(({ useChatStore }) => {
      const chat = useChatStore.getState();
      chat.setSidebarOpen(false);
      chat.setSidebarCollapsed(true);
    });
  },
  closeColumn: () => set({ columnOpen: false, replayFitting: false }),
  dismissColumn: () =>
    set({ columnOpen: false, columnDismissed: true, replayFitting: false }),
  clearReplay: () => set({ replayFitting: false }),
  setOnboardingActive: (onboardingActive) => set({ onboardingActive }),
}));

export function getInlineFittingSlot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(INLINE_FITTING_SLOT_ID);
}

export function getInlineFittingCardSlot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(INLINE_FITTING_CARD_SLOT_ID);
}
