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

/** Mirror chrome: stay on this page; missing twin opens The Fitting. */
export function requestMirror() {
  const fitting = useInlineFittingStore.getState();
  const accessMode = useAppSessionStore.getState().mode;
  const self = useSelfAvatarStore.getState();
  const tryon = useTryOnDrawerStore.getState();
  const avatarReady = self.status === "ready" && Boolean(self.avatarUrl);

  if (accessMode === "anonymous") {
    openAuthModal("signup");
    return;
  }

  if (fitting.onboardingActive || !avatarReady) {
    fitting.openColumn();
    return;
  }

  const entry = resolveMirrorEntry({
    accessMode,
    avatarReady,
    hasRackOrActive: tryon.activeIds.length > 0 || tryon.rackIds.length > 0,
  });

  if (entry === "fitting_room") {
    tryon.openFittingRoom();
    return;
  }
  void tryon.openAvatarViewer();
}
