"use client";

import { Menu } from "lucide-react";
import { requestMirror } from "@/components/tryon/request-mirror";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { BodyTwinSilhouette } from "@/components/onboarding/fitting/BodyTwinSilhouette";
import {
  formFromGender,
  type BuildKey,
} from "@/components/onboarding/fitting/types";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import { CartButton } from "@/components/cart/CartButton";
import { cn } from "@/lib/ai-chat/cn";

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

type Props = {
  className?: string;
  onOpenSidebar?: () => void;
};

/**
 * Mobile chrome: peeking twin bar above Find / Board / You.
 * Hidden while The Flick overlay is open (that screen has its own mirror).
 */
export function MirrorPeek({ className, onOpenSidebar }: Props) {
  const avatarUrl = useSelfAvatarStore((s) => s.avatarUrl);
  const status = useSelfAvatarStore((s) => s.status);
  const drawerOpen = useTryOnDrawerStore((s) => s.open);
  const resultUrl = useTryOnDrawerStore((s) => s.resultUrl);
  const dressing = useTryOnDrawerStore(
    (s) => s.status === "starting" || s.status === "processing",
  );
  const rackCount = useTryOnDrawerStore((s) => s.rackIds.length);
  const activeCount = useTryOnDrawerStore((s) => s.activeIds.length);
  const fittingColumnOpen = useInlineFittingStore((s) => s.columnOpen);
  const body = useUserProfileStore((s) => s.body);

  if (drawerOpen || fittingColumnOpen) return null;

  const form = formFromGender(body?.genderPresentation ?? "");
  const build = asBuild(body?.bodyType);

  const ready = status === "ready" && Boolean(avatarUrl);
  const thumb = activeCount > 0 && resultUrl ? resultUrl : avatarUrl;

  const statusLine =
    activeCount > 0
      ? `${activeCount} on you${rackCount > activeCount ? ` · ${rackCount} in the room` : ""}`
      : rackCount > 0
        ? `${rackCount} ready in the room`
        : ready
          ? "Nothing hanging yet"
          : "Create your twin";

  const openMirror = () => requestMirror();

  return (
    <div className={cn("shoop-mpeek", className)}>
      {onOpenSidebar ? (
        <button
          type="button"
          className="shoop-mpeek__menu"
          aria-label="Open sidebar"
          onClick={onOpenSidebar}
        >
          <Menu className="size-[18px]" strokeWidth={1.75} />
        </button>
      ) : null}

      <button
        type="button"
        data-tryon-trigger
        onClick={openMirror}
        aria-label={ready ? "Open The Flick" : "Create your avatar"}
        className="shoop-mpeek__hit"
      >
        <span className={cn("shoop-mpeek__frame", dressing && "is-live")}>
          {ready && thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" />
          ) : (
            <span className="shoop-mpeek__empty" aria-hidden>
              <BodyTwinSilhouette
                className="h-full w-auto"
                form={form}
                build={build}
                muscularity={null}
                bodyShape={null}
                bustFullness={null}
                legLine={null}
                heightCm={null}
                decorative
              />
            </span>
          )}
        </span>
        <span className="shoop-mpeek__tx">
          <b>Your twin</b>
          <em>{statusLine}</em>
        </span>
        <span className="shoop-mpeek__up">TRY ON ↑</span>
      </button>

      <CartButton className="shoop-mpeek__cart" />
    </div>
  );
}
