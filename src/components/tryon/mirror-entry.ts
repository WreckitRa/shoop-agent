import type { AppAccessMode } from "@/lib/client/app-session";

export type MirrorEntry =
  | "signup"
  | "onboarding"
  | "fitting_room"
  | "avatar_viewer";

export function accessNeedsAccountForMirror(mode: AppAccessMode): boolean {
  return mode === "anonymous";
}

export function guestFittingCtaLabel(
  kind: "overlay" | "button" | "look",
): string {
  if (kind === "overlay") return "CLAIM PRINT →";
  if (kind === "look") return "Sign up to see the full look";
  return "Sign up to see it on you";
}

export function resolveMirrorEntry(params: {
  accessMode: AppAccessMode;
  avatarReady: boolean;
  hasRackOrActive: boolean;
}): MirrorEntry {
  if (params.accessMode === "anonymous") return "signup";
  if (!params.avatarReady) return "onboarding";
  if (params.hasRackOrActive) return "fitting_room";
  return "avatar_viewer";
}
