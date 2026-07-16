"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { HangerIcon } from "@/components/tryon/HangerIcon";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";

/** Top-bar twin of the edge slider — always toggles the fitting room. */
export function TryOnTopBarButton({ className }: { className?: string }) {
  const open = useTryOnDrawerStore((s) => s.open);
  const status = useTryOnDrawerStore((s) => s.status);
  const resultUrl = useTryOnDrawerStore((s) => s.resultUrl);
  const openAvatarViewer = useTryOnDrawerStore((s) => s.openAvatarViewer);
  const busy =
    status === "loading_avatar" ||
    status === "starting" ||
    status === "processing";

  return (
    <button
      type="button"
      data-tryon-trigger
      onClick={() => void openAvatarViewer()}
      className={cn(
        "relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition hover:bg-surface-tint hover:text-ink",
        open && "bg-surface-tint text-ink",
        className,
      )}
      aria-label={`${open ? "Close" : "Open"} fitting room`}
      title="Fitting room"
    >
      {busy && open ? (
        <Loader2 className="size-[18px] animate-spin" strokeWidth={1.75} />
      ) : (
        <HangerIcon className="size-[18px]" />
      )}
      {resultUrl && !open ? (
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-brand" />
      ) : null}
    </button>
  );
}
