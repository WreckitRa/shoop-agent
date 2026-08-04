"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn, LogOut, Settings, UserPlus } from "lucide-react";
import { useSidebarUser } from "@/components/chat/useSidebarUser";
import { cn } from "@/lib/ai-chat/cn";
import { openAuthModal, useGuestMode } from "@/hooks/useGuestMode";
import { prepareClientForSignedOut } from "@/lib/client/identity-sync";

export function SidebarUserFooter() {
  const { initials, firstName, loading } = useSidebarUser();
  const { isGuest } = useGuestMode();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setOpen(false);
      await prepareClientForSignedOut();
      window.dispatchEvent(new Event("shoop-auth-changed"));
    } finally {
      setBusy(false);
    }
  }, []);

  const displayName = isGuest ? "Guest" : firstName;
  const displayInitials = isGuest ? "G" : initials;

  return (
    <div
      ref={rootRef}
      className="relative mt-2 shrink-0 border-t border-hairline pb-1 pt-3"
    >
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-hairline bg-white py-1 shadow-card"
        >
          {isGuest ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openAuthModal("signup");
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-brand transition hover:bg-brand-tint"
              >
                <UserPlus className="size-4 shrink-0" />
                Sign up to save
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openAuthModal("login");
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-surface-tint"
              >
                <LogIn className="size-4 shrink-0" />
                Sign in
              </button>
            </>
          ) : (
            <>
              <Link
                href="/profile"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-surface-tint"
              >
                <Settings className="size-4 shrink-0 text-ink-soft" />
                Settings
              </Link>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void logout()}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                <LogOut className="size-4 shrink-0" />
                Log out
              </button>
            </>
          )}
        </div>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 w-full items-center gap-2.5 rounded-xl px-2 text-left transition hover:bg-surface-tint",
          open && "bg-surface-tint",
        )}
      >
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-white text-[13px] font-bold",
            isGuest
              ? "border-info-accent text-info-accent"
              : "border-ink text-ink",
          )}
        >
          {displayInitials}
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-ink">
          {loading && !isGuest ? "…" : displayName}
        </span>
      </button>
    </div>
  );
}
