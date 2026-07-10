"use client";

import { useUserIdentity } from "@/hooks/useUserIdentity";

export function useSidebarUser() {
  const { initials, firstName, loading, identity } = useUserIdentity();
  return {
    initials,
    firstName,
    loading,
    preferredName: identity?.preferredName ?? null,
  };
}
