"use client";

import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";

/** Close the You mirror / fitting column so a new page is visible. */
export function closeYouOverlays() {
  useTryOnDrawerStore.getState().close();
  useInlineFittingStore.getState().closeColumn();
}
