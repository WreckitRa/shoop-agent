"use client";

import { cn } from "@/lib/ai-chat/cn";
import {
  openAuthModal,
  useGuestMode,
} from "@/hooks/useGuestMode";

export function GuestModeBanner() {
  const { isGuest } = useGuestMode();

  if (!isGuest) return null;

  const linkClass =
    "font-medium text-white underline decoration-white/40 underline-offset-[3px] transition hover:decoration-white";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative z-[90] shrink-0 bg-[#1a1f2e] text-center",
      )}
    >
      <p className="px-4 py-2.5 text-[13px] leading-snug text-white/90 sm:text-sm">
        <span className="font-semibold text-white">
          You&apos;re browsing as a guest.
        </span>{" "}
        Chats live on this device only —{" "}
        <button
          type="button"
          onClick={() => openAuthModal("signup")}
          className={linkClass}
        >
          Sign up free
        </button>{" "}
        to save everything, or{" "}
        <button
          type="button"
          onClick={() => openAuthModal("login")}
          className={linkClass}
        >
          sign in
        </button>
        .
      </p>
    </div>
  );
}
