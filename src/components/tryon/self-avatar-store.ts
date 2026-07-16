"use client";

import { create } from "zustand";
import { guestFetch } from "@/lib/client/guest-fetch";

type SelfAvatarStatus = "unknown" | "loading" | "ready" | "missing" | "signed_out";

type SelfAvatarState = {
  status: SelfAvatarStatus;
  personId: string | null;
  avatarUrl: string | null;
  createFlowOpen: boolean;
  /** Generation for ignoring stale refresh responses. */
  refreshGen: number;

  refresh: () => Promise<void>;
  markReady: (avatarUrl?: string | null) => void;
  openCreateFlow: () => void;
  closeCreateFlow: () => void;
};

export const useSelfAvatarStore = create<SelfAvatarState>((set, get) => ({
  status: "unknown",
  personId: null,
  avatarUrl: null,
  createFlowOpen: false,
  refreshGen: 0,

  refresh: async () => {
    const gen = get().refreshGen + 1;
    set({ status: "loading", refreshGen: gen });
    try {
      const res = await guestFetch("/api/avatar/people", { cache: "no-store" });
      if (get().refreshGen !== gen) return;
      if (res.status === 401) {
        set({
          status: "signed_out",
          personId: null,
          avatarUrl: null,
        });
        return;
      }
      if (!res.ok) {
        set({ status: "unknown" });
        return;
      }
      const body = (await res.json()) as {
        people?: Array<{
          id: string;
          relation: string;
          has_avatar: boolean;
          avatar_url: string | null;
        }>;
      };
      const self =
        body.people?.find((p) => p.relation === "self") ?? body.people?.[0];
      if (!self) {
        set({ status: "missing", personId: null, avatarUrl: null });
        return;
      }
      set({
        personId: self.id,
        avatarUrl: self.avatar_url,
        status: self.has_avatar ? "ready" : "missing",
      });
    } catch {
      if (get().refreshGen !== gen) return;
      set({ status: "unknown" });
    }
  },

  markReady: (avatarUrl) => {
    set((s) => ({
      status: "ready",
      avatarUrl: avatarUrl ?? s.avatarUrl,
      createFlowOpen: false,
    }));
  },

  openCreateFlow: () => {
    const { status, personId } = get();
    if (status === "signed_out") {
      window.location.href = "/profile";
      return;
    }
    if (!personId) {
      void get().refresh().then(() => {
        const next = get();
        if (next.personId) set({ createFlowOpen: true });
        else window.location.href = "/profile";
      });
      return;
    }
    set({ createFlowOpen: true });
  },

  closeCreateFlow: () => set({ createFlowOpen: false }),
}));

/** Effective try-on CTA after live avatar state (message tryon fields can be stale). */
export function resolveTryonCta(params: {
  available?: boolean;
  cta?: "create_avatar";
  avatarStatus: SelfAvatarStatus;
}): "tryon" | "create_avatar" | "hidden" {
  const avatarReady = params.avatarStatus === "ready";
  if (params.available === true) return "tryon";
  if (params.cta === "create_avatar") {
    return avatarReady ? "tryon" : "create_avatar";
  }
  return "hidden";
}
