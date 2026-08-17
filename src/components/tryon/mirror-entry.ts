import type { AppAccessMode } from "@/lib/client/app-session";

export type MirrorEntry =
  | "signup"
  | "create_avatar"
  | "fitting_room"
  | "avatar_viewer";

export function accessNeedsAccountForMirror(mode: AppAccessMode): boolean {
  return mode === "guest" || mode === "anonymous";
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
  if (accessNeedsAccountForMirror(params.accessMode)) return "signup";
  if (!params.avatarReady) return "create_avatar";
  if (params.hasRackOrActive) return "fitting_room";
  return "avatar_viewer";
}
