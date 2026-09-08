"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { requestMirror } from "@/components/tryon/request-mirror";
import {
  selfAvatarWaiting,
  useSelfAvatarStore,
} from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { BodyTwinSilhouette } from "@/components/onboarding/fitting/BodyTwinSilhouette";
import { SILHOUETTE_VIEWBOX } from "@/components/onboarding/fitting/bodySilhouetteGeometry";
import { formFromGender, type BuildKey } from "@/components/onboarding/fitting/types";
import { useUserIdentity } from "@/hooks/useUserIdentity";
import { extractFirstName } from "@/lib/shared/timeGreeting";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useClientIdentityScopeKey } from "@/lib/client/identity-sync";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  className?: string;
  /** Product/try-on image hovered from TODAY, ON YOU tiles */
  previewUrl?: string | null;
  /** Tighter vertical rhythm for the persistent chat rail. */
  compact?: boolean;
};

const BUILDS = new Set<BuildKey>([
  "slim",
  "average",
  "athletic",
  "broad",
  "plus",
]);

function asBuild(v: string | null | undefined): BuildKey | null {
  if (!v) return null;
  return BUILDS.has(v as BuildKey) ? (v as BuildKey) : null;
}

/**
 * “THE MIRROR” — live avatar, hover preview, moodboard entry.
 * Sticky/full-height rail on desktop; stacked card on mobile home.
 */
export function HomeMirrorCard({ className, previewUrl, compact }: Props) {
  const avatarUrl = useSelfAvatarStore((s) => s.avatarUrl);
  const status = useSelfAvatarStore((s) => s.status);
  const openFittingRoom = useTryOnDrawerStore((s) => s.openFittingRoom);
  const rackCount = useTryOnDrawerStore((s) => s.rackIds.length);
  const activeCount = useTryOnDrawerStore((s) => s.activeIds.length);
  const { preferredName, firstName } = useUserIdentity();
  const identityScope = useClientIdentityScopeKey();
  const body = useUserProfileStore((s) => s.body);
  const [moodCount, setMoodCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMoodCount(null);
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
  }, [identityScope]);

  const displayName =
    extractFirstName(preferredName) ??
    (firstName && firstName !== "Account" ? firstName : null);
  const nameLabel = displayName ? displayName.toUpperCase() : "YOU";
  const ready = Boolean(avatarUrl);
  const loading = selfAvatarWaiting(status, avatarUrl);
  const form = formFromGender(body?.genderPresentation ?? "");
  const build = asBuild(body?.bodyType);
  const hasBody = Boolean(
    body?.genderPresentation || body?.bodyType || body?.heightCm,
  );

  const openMirror = () => requestMirror();

  const openRoom = () => {
    if (!ready) {
      requestMirror();
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
        aria-label={
          ready
            ? "Open the Mirror"
            : loading
              ? "Loading your twin"
              : "Start onboarding — create your avatar"
        }
        className={cn(
          "relative flex-1 overflow-hidden rounded-lg border border-hairline bg-white text-left transition hover:border-ink/20",
          compact ? "min-h-[220px] lg:min-h-0" : "min-h-[280px] lg:min-h-[340px]",
        )}
      >
        {ready ? (
          <TwinFrame src={avatarUrl!} />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-[#FAFAFB] to-[#EFEFF2]">
            <div className="absolute inset-x-0 bottom-11 top-1 flex items-end justify-center">
              <div
                className="relative h-full max-h-full w-auto max-w-full text-[#7A7A86]"
                style={{
                  aspectRatio: `${SILHOUETTE_VIEWBOX.w} / ${SILHOUETTE_VIEWBOX.h}`,
                }}
                aria-hidden
              >
                <BodyTwinSilhouette
                  className="h-full w-full"
                  form={form}
                  build={build}
                  muscularity={null}
                  bodyShape={null}
                  bustFullness={null}
                  legLine={null}
                  heightCm={null}
                  decorative
                />
                {!loading && !hasBody ? (
                  <span className="absolute right-[4%] top-[6%] grid size-9 place-items-center rounded-full bg-[var(--fitting-red,#E42831)] font-display text-[22px] font-black leading-none text-white shadow-[0_8px_16px_-6px_rgba(228,40,49,0.75)]">
                    +
                  </span>
                ) : null}
              </div>
            </div>
            {loading ? (
              <div className="pointer-events-none absolute inset-x-3 bottom-12 text-center">
                <span className="font-display text-[13px] font-extrabold tracking-tight text-ink">
                  Loading your twin…
                </span>
              </div>
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
        <span>
          {ready
            ? "Fitting room"
            : "Create your twin"}
        </span>
        <span className="rounded-full bg-ink px-2 py-0.5 text-[9.5px] font-black text-white">
          {ready ? `${rackCount}` : "Start"}
        </span>
      </button>

      {ready ? (
        <button
          type="button"
          onClick={() => {
            openFittingRoom();
          }}
          className="mt-2 flex items-center justify-between rounded-[13px] border border-hairline bg-white px-3.5 py-2.5 text-[11.5px] font-bold text-ink transition hover:border-ink/20"
        >
          <span>Ask friends</span>
          <span className="rounded-full bg-brand px-2 py-0.5 text-[9.5px] font-black text-white">
            1 tap
          </span>
        </button>
      ) : null}
    </aside>
  );
}

/** Keep the last decoded frame until the next src loads — signed URLs must not blank the rail. */
function TwinFrame({ src }: { src: string }) {
  const [held, setHeld] = useState(src);
  const incoming = src !== held;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={held}
        alt=""
        className="absolute inset-0 size-full object-cover object-top"
      />
      {incoming ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-cover object-top"
          onLoad={() => setHeld(src)}
        />
      ) : null}
    </>
  );
}
