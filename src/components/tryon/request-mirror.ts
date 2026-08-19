"use client";

import { openAuthModal } from "@/hooks/useGuestMode";
import { useAppSessionStore } from "@/lib/client/app-session";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { resolveMirrorEntry } from "@/components/tryon/mirror-entry";

export {
  accessNeedsAccountForMirror,
  resolveMirrorEntry,
} from "@/components/tryon/mirror-entry";

/** Mirror chrome: stay on this page; guests without a twin start onboarding. */
export function requestMirror() {
  const fitting = useInlineFittingStore.getState();
  if (fitting.onboardingActive) {
    fitting.openColumn();
    return;
  }

  const accessMode = useAppSessionStore.getState().mode;
  const self = useSelfAvatarStore.getState();
  const tryon = useTryOnDrawerStore.getState();
  const entry = resolveMirrorEntry({
    accessMode,
    avatarReady: self.status === "ready" && Boolean(self.avatarUrl),
    hasRackOrActive: tryon.activeIds.length > 0 || tryon.rackIds.length > 0,
  });

  if (entry === "onboarding") {
    fitting.openColumn();
    return;
  }
  if (entry === "signup") {
    openAuthModal("signup");
    return;
  }
  if (entry === "create_avatar") {
    self.openCreateFlow();
    return;
  }
  if (entry === "fitting_room") {
    tryon.openFittingRoom();
    return;
  }
  void tryon.openAvatarViewer();
}
