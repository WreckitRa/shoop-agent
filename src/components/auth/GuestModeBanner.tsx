"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import {
  openAuthModal,
  useGuestHasPersistedData,
  useGuestMode,
} from "@/hooks/useGuestMode";

export function GuestModeBanner() {
  const { isGuest } = useGuestMode();
  const guestHasData = useGuestHasPersistedData(isGuest);

  if (!isGuest) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative z-[90] shrink-0 border-b border-hairline bg-warm/95 backdrop-blur-md",
        "supports-[backdrop-filter]:bg-warm/80",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 shoop-page-x py-2.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow-soft sm:mt-0"
            aria-hidden
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <p className="text-[13px] leading-snug text-ink-soft sm:text-sm">
            <span className="font-semibold text-ink">
              You&apos;re browsing as a guest.
            </span>{" "}
            Chats and preferences live on this device only —{" "}
            <button
              type="button"
              onClick={() => openAuthModal("signup")}
              className="font-medium text-ink underline decoration-ink/30 underline-offset-[3px] transition hover:decoration-ink"
            >
              Sign up free
            </button>{" "}
            to save everything
            {guestHasData ? (
              <>
                , or{" "}
                <button
                  type="button"
                  onClick={() => openAuthModal("login")}
                  className="font-medium text-ink underline decoration-ink/30 underline-offset-[3px] transition hover:decoration-ink"
                >
                  sign in
                </button>{" "}
                to open your account (guest data on this device will be erased).
              </>
            ) : (
              " and pick up where you left off on any device."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
