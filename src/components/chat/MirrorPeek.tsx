"use client";

import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { BuildSilhouette } from "@/components/tryon/avatar-silhouettes";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  className?: string;
};

/**
 * Mobile chat Mirror entry — avatar thumb in the thumb zone above the composer.
 * Opens the full fitting-room overlay; hidden while that overlay is open.
 */
export function MirrorPeek({ className }: Props) {
  const avatarUrl = useSelfAvatarStore((s) => s.avatarUrl);
  const status = useSelfAvatarStore((s) => s.status);
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const drawerOpen = useTryOnDrawerStore((s) => s.open);
  const openAvatarViewer = useTryOnDrawerStore((s) => s.openAvatarViewer);
  const openFittingRoom = useTryOnDrawerStore((s) => s.openFittingRoom);
  const rackCount = useTryOnDrawerStore((s) => s.rackIds.length);
  const activeCount = useTryOnDrawerStore((s) => s.activeIds.length);

  if (drawerOpen) return null;

  const ready = status === "ready" && Boolean(avatarUrl);
  const badge = activeCount > 0 ? activeCount : rackCount > 0 ? rackCount : null;

  const openMirror = () => {
    if (!ready) {
      openCreateFlow();
      return;
    }
    if (activeCount > 0 || rackCount > 0) {
      openFittingRoom();
      return;
    }
    void openAvatarViewer();
  };

  return (
    <button
      type="button"
      data-tryon-trigger
      onClick={openMirror}
      aria-label={ready ? "Open the Mirror" : "Create your avatar"}
      className={cn(
        "pointer-events-auto fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-3 z-30",
        "flex size-14 items-center justify-center overflow-hidden rounded-full",
        "border border-hairline bg-white shadow-[0_12px_28px_-12px_rgba(14,14,17,0.45)]",
        "transition hover:scale-[1.03] active:scale-[0.98] lg:hidden",
        className,
      )}
    >
      {ready ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl!}
          alt=""
          className="size-full object-cover object-top"
        />
      ) : (
        <span className="opacity-70" aria-hidden>
          <BuildSilhouette width={14} />
        </span>
      )}
      {badge != null ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[9px] font-black text-white">
          {badge}
        </span>
      ) : (
        <span className="absolute inset-x-1 bottom-1 rounded-full bg-white/90 py-px text-center text-[7px] font-extrabold tracking-[0.12em] text-ink">
          MIRROR
        </span>
      )}
    </button>
  );
}
