"use client";

import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { HangerIcon } from "@/components/tryon/HangerIcon";
import { cn } from "@/lib/ai-chat/cn";
import { Loader2 } from "lucide-react";

/**
 * Persistent edge tab — always available to reopen the fitting room
 * (avatar + last try-on).
 */
export function TryOnAvatarSlider() {
  const open = useTryOnDrawerStore((s) => s.open);
  const status = useTryOnDrawerStore((s) => s.status);
  const openAvatarViewer = useTryOnDrawerStore((s) => s.openAvatarViewer);

  const loading =
    status === "loading_avatar" ||
    status === "starting" ||
    status === "processing";

  if (open) return null;

  return (
    <button
      type="button"
      data-tryon-trigger
      onClick={() => void openAvatarViewer()}
      aria-label="Open fitting room"
      className={cn(
        "group absolute right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2.5",
        "rounded-l-2xl border border-r-0 border-hairline bg-white/95 py-3.5 pl-2 pr-1.5",
        "shadow-[-6px_0_24px_rgba(12,12,12,0.08)] backdrop-blur-md",
        "text-ink-secondary transition hover:bg-white hover:pr-2 hover:text-ink",
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-surface-tint ring-1 ring-hairline transition group-hover:bg-white">
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <HangerIcon className="size-[18px]" />
        )}
      </span>
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
    </button>
  );
}
