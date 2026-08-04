"use client";

import { useEffect } from "react";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { BuildSilhouette } from "@/components/tryon/avatar-silhouettes";
import { useUserIdentity } from "@/hooks/useUserIdentity";
import { extractFirstName } from "@/lib/shared/timeGreeting";
import { MAX_FITTING_ROOM_ITEMS } from "@/lib/tryon/fitting-room-types";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  className?: string;
};

/**
 * Home “THE MIRROR” card — live avatar + fitting-room entry (no mock data).
 */
export function HomeMirrorCard({ className }: Props) {
  const avatarUrl = useSelfAvatarStore((s) => s.avatarUrl);
  const status = useSelfAvatarStore((s) => s.status);
  const refresh = useSelfAvatarStore((s) => s.refresh);
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const openAvatarViewer = useTryOnDrawerStore((s) => s.openAvatarViewer);
  const openFittingRoom = useTryOnDrawerStore((s) => s.openFittingRoom);
  const rackCount = useTryOnDrawerStore((s) => s.rackIds.length);
  const activeCount = useTryOnDrawerStore((s) => s.activeIds.length);
  const { preferredName, firstName } = useUserIdentity();

  useEffect(() => {
    if (status === "unknown") void refresh();
  }, [status, refresh]);

  const displayName =
    extractFirstName(preferredName) ??
    (firstName && firstName !== "Account" ? firstName : null);
  const nameLabel = displayName ? displayName.toUpperCase() : "YOU";
  const ready = status === "ready" && Boolean(avatarUrl);
  const loading = status === "loading";

  const openMirror = () => {
    if (ready) {
      void openAvatarViewer();
      return;
    }
    openCreateFlow();
  };

  const openRoom = () => {
    if (!ready) {
      openCreateFlow();
      return;
    }
    openFittingRoom();
  };

  const statusDetail = loading
    ? "loading…"
    : !ready
      ? "set up your twin"
      : activeCount > 0
        ? `${activeCount} on you`
        : rackCount > 0
          ? `${rackCount} in rack`
          : "your twin";

  return (
    <aside
      className={cn(
        "flex flex-col rounded-[18px] border border-hairline bg-gradient-to-b from-[#FCFCFD] to-[#F5F5F7] px-[18px] py-4",
        "lg:sticky lg:top-3.5 lg:min-h-[calc(100vh-7.5rem)]",
        className,
      )}
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="font-display text-[9.5px] font-extrabold tracking-[0.22em] text-ink">
          THE MIRROR
        </span>
        <span className="text-[9px] font-semibold text-ink-muted">
          where everything lands
        </span>
      </div>

      <button
        type="button"
        data-tryon-trigger
        onClick={openMirror}
        aria-label={ready ? "Open fitting room" : "Create your avatar"}
        className="relative min-h-[280px] flex-1 overflow-hidden rounded-lg border border-hairline bg-white text-left transition hover:border-ink/20 lg:min-h-[340px]"
      >
        {ready ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl!}
            alt=""
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#FAFAFB] to-[#EFEFF2] px-6 text-center">
            <span className="opacity-70" aria-hidden>
              <BuildSilhouette width={16} />
            </span>
            <span className="font-display text-[13px] font-extrabold tracking-tight text-ink">
              {loading ? "Loading your twin…" : "See it on you"}
            </span>
            {!loading ? (
              <span className="text-[11px] font-medium text-ink-muted">
                Tap to create your avatar
              </span>
            ) : null}
          </div>
        )}

        <div className="absolute inset-x-2.5 bottom-2.5 rounded-full bg-white/92 px-3 py-1.5 text-center text-[9.5px] font-semibold text-ink-muted">
          <b className="font-extrabold text-ink">{nameLabel}</b>
          {" · "}
          {statusDetail}
        </div>
      </button>

      <button
        type="button"
        data-tryon-trigger
        onClick={openRoom}
        className="mt-3 flex items-center justify-between rounded-[13px] border border-hairline bg-white px-3.5 py-2.5 text-[11.5px] font-bold text-ink transition hover:border-ink/20"
      >
        <span>{ready ? "Fitting room" : "Create your twin"}</span>
        <span className="rounded-full bg-brand px-2 py-0.5 text-[9.5px] font-black text-white">
          {ready
            ? `${rackCount}/${MAX_FITTING_ROOM_ITEMS}`
            : "Start"}
        </span>
      </button>
    </aside>
  );
}
