"use client";

import { useEffect } from "react";
import { seedUserIdentityFromServer } from "@/hooks/useUserIdentity";
import { useAppSessionStore } from "@/lib/client/app-session";
import { useUserProfileStore } from "@/lib/client/user-profile-store";

/** Seeds greeting identity only for the currently signed-in account. */
export function PreferredNameSeed({
  preferredName,
}: {
  preferredName?: string | null;
}) {
  const accessMode = useAppSessionStore((s) => s.mode);
  const authUserId = useAppSessionStore((s) => s.authUserId);
  const authUserEmail = useAppSessionStore((s) => s.authUserEmail);

  useEffect(() => {
    if (accessMode === "loading") return;
    if (accessMode !== "authenticated" || !authUserId) {
      useUserProfileStore.getState().reset();
      return;
    }
    seedUserIdentityFromServer(preferredName, authUserEmail, authUserId);
  }, [preferredName, accessMode, authUserId, authUserEmail]);

  return null;
}
