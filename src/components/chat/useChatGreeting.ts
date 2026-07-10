"use client";

import { useEffect, useState } from "react";
import { buildGreeting } from "@/lib/shared/timeGreeting";
import { useAppSessionStore } from "@/lib/client/app-session";
import { useUserProfileStore } from "@/lib/client/user-profile-store";

export function useChatGreeting(): string {
  const accessMode = useAppSessionStore((s) => s.mode);
  const preferredName = useUserProfileStore(
    (s) => s.identity?.preferredName ?? null,
  );

  const [greeting, setGreeting] = useState(() => buildGreeting(null));

  useEffect(() => {
    const name = accessMode === "authenticated" ? preferredName : null;
    const refresh = () => setGreeting(buildGreeting(name));
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(interval);
  }, [accessMode, preferredName]);

  return greeting;
}
