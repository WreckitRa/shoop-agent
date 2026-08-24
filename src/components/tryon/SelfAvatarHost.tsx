"use client";

import { useEffect } from "react";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";

/** Boots self-avatar readiness so Mirror CTAs know if a twin exists. */
export function SelfAvatarHost() {
  const status = useSelfAvatarStore((s) => s.status);
  const refresh = useSelfAvatarStore((s) => s.refresh);

  useEffect(() => {
    if (status === "unknown") void refresh();
  }, [status, refresh]);

  return null;
}
