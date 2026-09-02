"use client";

import { create } from "zustand";
import { useAppSessionStore } from "@/lib/client/app-session";
import { guestNeedsOnboardingLeaveWarning } from "./fitting/leave-warning";
import {
  markOnboardingUiDismissed,
  markOnboardingUiResumed,
  readOnboardingUiSession,
  sessionIsMagicLocked,
  writeOnboardingUiSession,
} from "./fitting/ui-session";

export const INLINE_FITTING_SLOT_ID = "shoop-inline-fitting";
export const INLINE_FITTING_CARD_SLOT_ID = "shoop-inline-fitting-card";

type InlineFittingState = {
  columnOpen: boolean;
  onboardingActive: boolean;
  /** Lock the chat composer once they hit Lock it in (honesty → verdict). */
  composerLocked: boolean;
  /** Scan/verdict/circle — hide chat + chrome, Fitting is the page. */
  stageLocked: boolean;
  /** Photo step, no face yet — twin sits under the questions, not the rail. */
  twinDock: "flow" | "rail";
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
  setComposerLocked: (locked: boolean) => void;
  setStageLocked: (locked: boolean) => void;
  setTwinDock: (dock: "flow" | "rail") => void;
};

export const useInlineFittingStore = create<InlineFittingState>((set, get) => ({
  columnOpen: false,
  onboardingActive: false,
  composerLocked: false,
  stageLocked: false,
  twinDock: "rail",
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
      stageLocked: sessionIsMagicLocked(session),
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
      stageLocked: sessionIsMagicLocked(readOnboardingUiSession()),
    });
    void import("@/components/chat/chat-store").then(({ useChatStore }) => {
      const chat = useChatStore.getState();
      chat.setSidebarOpen(false);
      chat.setSidebarCollapsed(true);
    });
  },
  closeColumn: () =>
    set({
      columnOpen: false,
      replayFitting: false,
      pendingLeave: false,
      composerLocked: false,
      stageLocked: false,
      twinDock: "rail",
    }),
  dismissColumn: () => {
    markOnboardingUiDismissed();
    set({
      columnOpen: false,
      columnDismissed: true,
      replayFitting: false,
      pendingLeave: false,
      composerLocked: false,
      stageLocked: false,
      twinDock: "rail",
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
  setComposerLocked: (composerLocked) => set({ composerLocked }),
  setStageLocked: (stageLocked) => {
    writeOnboardingUiSession({ locked: stageLocked });
    set({ stageLocked });
  },
  setTwinDock: (twinDock) => set({ twinDock }),
}));

export function getInlineFittingSlot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(INLINE_FITTING_SLOT_ID);
}

export function getInlineFittingCardSlot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(INLINE_FITTING_CARD_SLOT_ID);
}
