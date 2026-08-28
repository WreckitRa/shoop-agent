"use client";

import { create } from "zustand";
import { useAppSessionStore } from "@/lib/client/app-session";
import { guestNeedsOnboardingLeaveWarning } from "./fitting/leave-warning";
import {
  markOnboardingUiDismissed,
  markOnboardingUiResumed,
  readOnboardingUiSession,
} from "./fitting/ui-session";

export const INLINE_FITTING_SLOT_ID = "shoop-inline-fitting";
export const INLINE_FITTING_CARD_SLOT_ID = "shoop-inline-fitting-card";

type InlineFittingState = {
  columnOpen: boolean;
  onboardingActive: boolean;
  /** User closed the column — don't auto-reopen or fall back to fullscreen. */
  columnDismissed: boolean;
  /** Re-open The Fitting after onboarding is already complete (create/update twin). */
  replayFitting: boolean;
  /** Guest close-intercept: FOMO sheet is up. */
  pendingLeave: boolean;
  openColumn: () => void;
  /** Re-open an in-progress Fitting after refresh — does not restart. */
  resumeColumn: () => void;
  closeColumn: () => void;
  dismissColumn: () => void;
  /** Close Fitting — guests who haven't signed up see FOMO first. */
  requestDismiss: () => void;
  cancelLeave: () => void;
  confirmLeave: () => void;
  clearReplay: () => void;
  setOnboardingActive: (active: boolean) => void;
};

export const useInlineFittingStore = create<InlineFittingState>((set, get) => ({
  columnOpen: false,
  onboardingActive: false,
  columnDismissed: false,
  replayFitting: false,
  pendingLeave: false,
  openColumn: () => {
    const session = readOnboardingUiSession();
    const resumeInProgress =
      get().onboardingActive || Boolean(session && session.dismissed !== true);
    markOnboardingUiResumed();
    set({
      columnOpen: true,
      columnDismissed: false,
      replayFitting: !resumeInProgress,
      pendingLeave: false,
    });
    void import("@/components/chat/chat-store").then(({ useChatStore }) => {
      const chat = useChatStore.getState();
      chat.setSidebarOpen(false);
      chat.setSidebarCollapsed(true);
    });
  },
  resumeColumn: () => {
    markOnboardingUiResumed();
    set({
      columnOpen: true,
      columnDismissed: false,
      pendingLeave: false,
    });
    void import("@/components/chat/chat-store").then(({ useChatStore }) => {
      const chat = useChatStore.getState();
      chat.setSidebarOpen(false);
      chat.setSidebarCollapsed(true);
    });
  },
  closeColumn: () =>
    set({ columnOpen: false, replayFitting: false, pendingLeave: false }),
  dismissColumn: () => {
    markOnboardingUiDismissed();
    set({
      columnOpen: false,
      columnDismissed: true,
      replayFitting: false,
      pendingLeave: false,
    });
  },
  requestDismiss: () => {
    const { columnOpen, onboardingActive } = get();
    if (
      guestNeedsOnboardingLeaveWarning({
        accessMode: useAppSessionStore.getState().mode,
        columnOpen,
        onboardingActive,
      })
    ) {
      set({ pendingLeave: true });
      return;
    }
    get().dismissColumn();
  },
  cancelLeave: () => set({ pendingLeave: false }),
  confirmLeave: () => get().dismissColumn(),
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
