"use client";

import { useEffect } from "react";
import {
  canFetchUserScopedData,
  useAppSessionStore,
} from "@/lib/client/app-session";
import { useUserProfileStore } from "@/lib/client/user-profile-store";

/** Subscribe to cached user identity; hydrates once and reuses across navigations. */
export function useUserIdentity() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const identity = useUserProfileStore((s) => s.identity);
  const hydrating = useUserProfileStore((s) => s.hydrating);
  const hydrate = useUserProfileStore((s) => s.hydrate);

  useEffect(() => {
    if (!canFetchUserScopedData(accessMode)) return;
    void hydrate();
  }, [accessMode, hydrate]);

  return {
    identity,
    initials: identity?.initials ?? "?",
    firstName: identity?.firstName ?? "Account",
    preferredName: identity?.preferredName ?? null,
    email: identity?.email ?? null,
    loading: hydrating && !identity,
  };
}

/** Red dot on Settings when onboarding is still incomplete. */
export function useShowSettingsBadge() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const onboardingCompleted = useUserProfileStore((s) => s.onboardingCompleted);
  const hydrate = useUserProfileStore((s) => s.hydrate);

  useEffect(() => {
    if (!canFetchUserScopedData(accessMode)) return;
    void hydrate();
  }, [accessMode, hydrate]);

  return onboardingCompleted === false;
}

/** Call once when server already knows profile fields (e.g. home page). */
export function seedUserIdentityFromServer(
  preferredName?: string | null,
  email?: string | null,
  userId?: string,
) {
  useUserProfileStore.getState().seedIdentity({ preferredName, email, userId });
}
