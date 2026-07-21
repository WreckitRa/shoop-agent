"use client";

import { useEffect, useState } from "react";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { BuildSilhouette } from "@/components/tryon/avatar-silhouettes";
import { HangerIcon } from "@/components/tryon/HangerIcon";
import { cn } from "@/lib/ai-chat/cn";
import { Loader2 } from "lucide-react";

const TRYON_PEEK_SEEN_KEY = "shoop:tryon-peek-seen:v1";

/**
 * Persistent edge tab — always available to reopen the fitting room
 * (avatar + last try-on).
 */
export function TryOnAvatarSlider() {
  const open = useTryOnDrawerStore((s) => s.open);
  const status = useTryOnDrawerStore((s) => s.status);
  const rackCount = useTryOnDrawerStore((s) => s.rackIds.length);
  const activeCount = useTryOnDrawerStore((s) => s.activeIds.length);
  const openAvatarViewer = useTryOnDrawerStore((s) => s.openAvatarViewer);
  const avatarUrl = useSelfAvatarStore((s) => s.avatarUrl);
  const [peeking, setPeeking] = useState(false);

  const loading =
    status === "loading_avatar" ||
    status === "starting" ||
    status === "processing";

  const badgeCount = Math.max(rackCount, activeCount);

  useEffect(() => {
    let hasSeenPeek = false;
    try {
      hasSeenPeek = Boolean(
        window.localStorage.getItem(TRYON_PEEK_SEEN_KEY),
      );
    } catch {
      // Storage can be unavailable in private browsing; still show the peek.
    }
    if (hasSeenPeek) return;

    const revealTimer = window.setTimeout(() => {
      setPeeking(true);
      try {
        window.localStorage.setItem(TRYON_PEEK_SEEN_KEY, "1");
      } catch {
        // The peek still works when storage is unavailable.
      }
    }, 900);
    const hideTimer = window.setTimeout(() => setPeeking(false), 7500);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (open) return null;

  return (
    <button
      type="button"
      data-tryon-trigger
      onClick={() => {
        setPeeking(false);
        void openAvatarViewer();
      }}
      aria-label="Open fitting room"
      className={cn(
        "group absolute right-0 top-1/2 z-30 flex -translate-y-1/2 items-center overflow-hidden",
        "rounded-l-2xl border border-r-0 border-hairline bg-white/95",
        "shadow-[-6px_0_24px_rgba(12,12,12,0.08)] backdrop-blur-md",
        "text-ink-secondary transition-all duration-500 ease-out hover:bg-white hover:text-ink",
        peeking
          ? "w-[min(13.5rem,calc(100vw-1rem))] flex-row gap-3 px-3 py-3 sm:w-[min(15rem,calc(100vw-1rem))]"
          : "w-[3.25rem] flex-col gap-2.5 py-3.5 pl-2 pr-1.5 hover:pr-2",
      )}
    >
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-tint ring-1 ring-hairline transition-all group-hover:bg-white",
          peeking ? "size-14" : "size-9",
        )}
      >
        {badgeCount > 0 ? (
          <span className="absolute -left-1 -top-1 z-10 flex size-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white">
            {badgeCount}
          </span>
        ) : null}
        {peeking && avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-full object-cover object-top"
          />
        ) : peeking ? (
          <span className="scale-90" aria-hidden>
            <BuildSilhouette width={14} />
          </span>
        ) : loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <HangerIcon className="size-[18px]" />
        )}
      </span>
      {peeking ? (
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-serif text-lg font-semibold leading-tight text-ink">
            See it on you.
          </span>
          <span className="mt-1 block text-[11px] leading-snug text-ink-muted">
            Open your fitting room
          </span>
        </span>
      ) : (
        <span className="relative h-[5.5rem] w-3.5 overflow-hidden">
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center",
              "select-none text-[10px] font-semibold uppercase tracking-[0.16em]",
              "[writing-mode:vertical-rl] rotate-180",
              "transition-opacity duration-200 group-hover:pointer-events-none group-hover:opacity-0",
            )}
            aria-hidden
          >
            You
          </span>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center",
              "select-none text-[10px] font-semibold uppercase tracking-[0.14em]",
              "[writing-mode:vertical-rl] rotate-180",
              "opacity-0 transition-opacity duration-200 group-hover:opacity-100",
            )}
            aria-hidden
          >
            Fitting room
          </span>
        </span>
      )}
    </button>
  );
}
