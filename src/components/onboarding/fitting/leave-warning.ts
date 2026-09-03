import type { AppAccessMode } from "@/lib/client/app-session";

/** Browser `beforeunload` copy when a guest walks away mid-Fitting. */
export const ONBOARDING_LEAVE_UNLOAD_MESSAGE =
  "Your fitting isn't saved to an account. Leave now and this twin, the scan, and your picks stay in this browser — and we delete the photograph and the measurements from this visit.";

/** Guests who haven't signed up yet — only when The Fitting is actually on screen. */
export function guestNeedsOnboardingLeaveWarning(args: {
  accessMode: AppAccessMode;
  columnOpen: boolean;
  stageLocked?: boolean;
}): boolean {
  if (args.accessMode === "authenticated" || args.accessMode === "local") {
    return false;
  }
  return args.columnOpen || args.stageLocked === true;
}
