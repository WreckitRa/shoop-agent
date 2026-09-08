"use client";

import { create } from "zustand";
import { openAuthModal } from "@/hooks/useGuestMode";
import { useAppSessionStore } from "@/lib/client/app-session";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { accessNeedsAccountForMirror } from "@/components/tryon/mirror-entry";

export type SelfAvatarStatus =
  | "unknown"
  | "loading"
  | "ready"
  | "missing"
  | "signed_out";

export type SelfAvatarSnapshot = {
  status: SelfAvatarStatus;
  personId: string | null;
  avatarUrl: string | null;
};

type AvatarPeopleRow = {
  id: string;
  relation: string;
  has_avatar: boolean;
  avatar_url: string | null;
};

type SelfAvatarState = SelfAvatarSnapshot & {
  /** Generation for ignoring stale refresh responses. */
  refreshGen: number;

  refresh: () => Promise<void>;
  markReady: (avatarUrl?: string | null) => void;
  /** Drop the previous identity's twin before the next hydrate. */
  resetForIdentityChange: () => void;
  /** Open The Fitting so the shopper can create their twin. */
  openCreateFlow: () => void;
};

/** True while we should show “Loading your twin…” — never if a frame is already on screen. */
export function selfAvatarWaiting(
  status: SelfAvatarStatus,
  avatarUrl: string | null,
): boolean {
  if (avatarUrl) return false;
  return status === "loading" || status === "unknown";
}

/**
 * Keep a painted twin across refetch. Signed URLs rotate every /people call;
 * swapping src blanks the <img>. A brief “missing” while guest→user migrate
 * finishes must not unmount a twin we already have.
 */
export function resolveSelfAvatarFromPeople(
  prev: SelfAvatarSnapshot,
  people: AvatarPeopleRow[] | undefined,
): SelfAvatarSnapshot {
  const self = people?.find((p) => p.relation === "self") ?? people?.[0];
  if (!self) {
    if (prev.avatarUrl) return prev;
    return { status: "missing", personId: null, avatarUrl: null };
  }
  if (self.has_avatar) {
    return {
      status: "ready",
      personId: self.id,
      avatarUrl: prev.avatarUrl ?? self.avatar_url,
    };
  }
  if (prev.avatarUrl) {
    return { status: "ready", personId: self.id, avatarUrl: prev.avatarUrl };
  }
  return { status: "missing", personId: self.id, avatarUrl: null };
}

let refreshInFlight: Promise<void> | null = null;

export const useSelfAvatarStore = create<SelfAvatarState>((set, get) => ({
  status: "unknown",
  personId: null,
  avatarUrl: null,
  refreshGen: 0,

  refresh: () => {
    if (refreshInFlight) return refreshInFlight;
    const gen = get().refreshGen + 1;
    const keepReady = Boolean(get().avatarUrl) && get().status === "ready";
    set({
      status: keepReady ? "ready" : "loading",
      refreshGen: gen,
    });
    const run = (async () => {
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
          if (!get().avatarUrl) set({ status: "unknown" });
          return;
        }
        const body = (await res.json()) as { people?: AvatarPeopleRow[] };
        if (get().refreshGen !== gen) return;
        set(resolveSelfAvatarFromPeople(get(), body.people));
      } catch {
        if (get().refreshGen !== gen) return;
        if (!get().avatarUrl) set({ status: "unknown" });
      }
    })();
    refreshInFlight = run;
    void run.finally(() => {
      if (refreshInFlight === run) refreshInFlight = null;
    });
    return run;
  },

  markReady: (avatarUrl) => {
    set((s) => ({
      status: "ready",
      avatarUrl: avatarUrl ?? s.avatarUrl,
      refreshGen: s.refreshGen + 1,
    }));
  },

  resetForIdentityChange: () => {
    refreshInFlight = null;
    set((s) => ({
      status: "unknown",
      personId: null,
      avatarUrl: null,
      refreshGen: s.refreshGen + 1,
    }));
  },

  openCreateFlow: () => {
    const mode = useAppSessionStore.getState().mode;
    if (accessNeedsAccountForMirror(mode)) {
      openAuthModal("signup");
      return;
    }
    useInlineFittingStore.getState().openColumn();
  },
}));

/** Effective try-on CTA after live avatar state (message tryon fields can be stale). */
export function resolveTryonCta(params: {
  available?: boolean;
  cta?: "create_avatar";
  avatarStatus: SelfAvatarStatus;
}): "tryon" | "create_avatar" | "hidden" {
  const canOffer =
    params.available === true || params.cta === "create_avatar";
  if (!canOffer) return "hidden";

  if (params.avatarStatus === "ready") return "tryon";
  if (
    params.avatarStatus === "missing" ||
    params.avatarStatus === "signed_out"
  ) {
    return "create_avatar";
  }
  // unknown / loading: trust the contract so we don't flash CREATE AVATAR
  // on a shopper who already has a twin.
  if (params.cta === "create_avatar") return "create_avatar";
  return "tryon";
}
