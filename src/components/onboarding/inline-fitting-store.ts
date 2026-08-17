"use client";

import { create } from "zustand";

export const INLINE_FITTING_SLOT_ID = "shoop-inline-fitting";
export const INLINE_FITTING_CARD_SLOT_ID = "shoop-inline-fitting-card";

type InlineFittingState = {
  columnOpen: boolean;
  onboardingActive: boolean;
  /** User closed the column — don't auto-reopen or fall back to fullscreen. */
  columnDismissed: boolean;
  openColumn: () => void;
  closeColumn: () => void;
  dismissColumn: () => void;
  setOnboardingActive: (active: boolean) => void;
};

export const useInlineFittingStore = create<InlineFittingState>((set) => ({
  columnOpen: false,
  onboardingActive: false,
  columnDismissed: false,
  openColumn: () => {
    set({ columnOpen: true, columnDismissed: false });
    void import("@/components/chat/chat-store").then(({ useChatStore }) => {
      const chat = useChatStore.getState();
      chat.setSidebarOpen(false);
      chat.setSidebarCollapsed(true);
    });
  },
  closeColumn: () => set({ columnOpen: false }),
  dismissColumn: () => set({ columnOpen: false, columnDismissed: true }),
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
