"use client";

import { create } from "zustand";
import { isGuestSessionActive } from "@/lib/client/guest-storage";

/** Who can use the app shell and call user-scoped APIs. */
export type AppAccessMode =
  | "loading"
  | "anonymous"
  | "guest"
  | "authenticated"
  /** Supabase auth disabled — local/dev open mode. */
  | "local";

export function resolveAppAccessMode(args: {
  authConfigured: boolean;
  user: { id: string } | null;
}): AppAccessMode {
  if (!args.authConfigured) return "local";
  if (args.user) return "authenticated";
  if (isGuestSessionActive()) return "guest";
  return "anonymous";
}

export function canFetchUserScopedData(mode: AppAccessMode): boolean {
  return mode === "authenticated" || mode === "guest" || mode === "local";
}

type AppSessionState = {
  mode: AppAccessMode;
  authConfigured: boolean;
  authUserId: string | null;
  authUserEmail: string | null;
  syncFromAuth: (args: {
    authConfigured: boolean;
    user: { id: string; email?: string | null } | null;
  }) => void;
  setGuest: () => void;
  setLoading: () => void;
};

export const useAppSessionStore = create<AppSessionState>((set) => ({
  mode: "loading",
  authConfigured: true,
  authUserId: null,
  authUserEmail: null,
  syncFromAuth: (args) =>
    set({
      mode: resolveAppAccessMode(args),
      authConfigured: args.authConfigured,
      authUserId: args.user?.id ?? null,
      authUserEmail: args.user?.email ?? null,
    }),
  setGuest: () =>
    set({
      mode: "guest",
      authUserId: null,
      authUserEmail: null,
    }),
  setLoading: () => set({ mode: "loading" }),
}));
