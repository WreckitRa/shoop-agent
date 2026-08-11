"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { BuildSilhouette } from "@/components/tryon/avatar-silhouettes";
import { useUserIdentity } from "@/hooks/useUserIdentity";
import { extractFirstName } from "@/lib/shared/timeGreeting";
import { guestFetch } from "@/lib/client/guest-fetch";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  className?: string;
  /** Product/try-on image hovered from TODAY, ON YOU tiles */
  previewUrl?: string | null;
  /** Tighter vertical rhythm for the persistent chat rail. */
  compact?: boolean;
};

/**
 * “THE MIRROR” — live avatar, hover preview, moodboard entry.
 * Sticky/full-height rail on desktop; stacked card on mobile home.
 */
export function HomeMirrorCard({ className, previewUrl, compact }: Props) {
  const avatarUrl = useSelfAvatarStore((s) => s.avatarUrl);
  const status = useSelfAvatarStore((s) => s.status);
  const refresh = useSelfAvatarStore((s) => s.refresh);
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const openAvatarViewer = useTryOnDrawerStore((s) => s.openAvatarViewer);
  const openFittingRoom = useTryOnDrawerStore((s) => s.openFittingRoom);
  const rackCount = useTryOnDrawerStore((s) => s.rackIds.length);
  const activeCount = useTryOnDrawerStore((s) => s.activeIds.length);
  const { preferredName, firstName } = useUserIdentity();
  const [moodCount, setMoodCount] = useState<number | null>(null);

  useEffect(() => {
    if (status === "unknown") void refresh();
  }, [status, refresh]);

  useEffect(() => {
    let cancelled = false;
    void guestFetch("/api/tryon/moodboard", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { items?: unknown[] };
        if (!cancelled) setMoodCount(body.items?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) setMoodCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        "lg:min-h-0 lg:flex-1",
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
        className={cn(
          "relative flex-1 overflow-hidden rounded-lg border border-hairline bg-white text-left transition hover:border-ink/20",
          compact ? "min-h-[220px] lg:min-h-0" : "min-h-[280px] lg:min-h-[340px]",
        )}
      >
        {ready ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl!}
            alt=""
            className="absolute inset-0 size-full object-cover object-top transition-opacity duration-300"
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

        {previewUrl ? (
          <div
            className="pointer-events-none absolute left-1/2 top-[12%] z-[1] h-[190px] w-[150px] -translate-x-1/2 overflow-hidden rounded-md shadow-[0_24px_44px_-20px_rgba(14,14,17,0.45)] transition-transform duration-280"
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="size-full object-cover object-top"
            />
          </div>
        ) : null}

        <div className="absolute inset-x-2.5 bottom-2.5 z-[2] rounded-full bg-white/92 px-3 py-1.5 text-center text-[9.5px] font-semibold text-ink-muted">
          <b className="font-extrabold text-ink">{nameLabel}</b>
          {" · "}
          {statusDetail}
        </div>
      </button>

      <Link
        href="/moodboard"
        className="mt-3 flex items-center justify-between rounded-[13px] border border-hairline bg-white px-3.5 py-2.5 text-[11.5px] font-bold text-ink transition hover:border-ink/20"
      >
        <span>My Moodboard</span>
        <span className="rounded-full bg-brand px-2 py-0.5 text-[9.5px] font-black text-white">
          {moodCount != null ? `${moodCount}` : "Open"}
        </span>
      </Link>

      <button
        type="button"
        data-tryon-trigger
        onClick={openRoom}
        className="mt-3 flex items-center justify-between rounded-[13px] border border-hairline bg-white px-3.5 py-2.5 text-[11.5px] font-bold text-ink transition hover:border-ink/20"
      >
        <span>{ready ? "Fitting room" : "Create your twin"}</span>
        <span className="rounded-full bg-ink px-2 py-0.5 text-[9.5px] font-black text-white">
          {ready ? `${rackCount}` : "Start"}
        </span>
      </button>
    </aside>
  );
}
