"use client";

import { requestMirror } from "@/components/tryon/request-mirror";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { BuildSilhouette } from "@/components/tryon/avatar-silhouettes";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  className?: string;
};

/**
 * Mobile chat Mirror entry — mini frame in the thumb zone above the composer.
 * Opens the fitting-room overlay; hidden while that overlay is open.
 */
export function MirrorPeek({ className }: Props) {
  const avatarUrl = useSelfAvatarStore((s) => s.avatarUrl);
  const status = useSelfAvatarStore((s) => s.status);
  const drawerOpen = useTryOnDrawerStore((s) => s.open);
  const resultUrl = useTryOnDrawerStore((s) => s.resultUrl);
  const dressing = useTryOnDrawerStore(
    (s) => s.status === "starting" || s.status === "processing",
  );
  const rackCount = useTryOnDrawerStore((s) => s.rackIds.length);
  const activeCount = useTryOnDrawerStore((s) => s.activeIds.length);

  if (drawerOpen) return null;

  const ready = status === "ready" && Boolean(avatarUrl);
  const thumb = activeCount > 0 && resultUrl ? resultUrl : avatarUrl;
  const badge = activeCount > 0 ? activeCount : rackCount > 0 ? rackCount : null;

  const openMirror = () => requestMirror();

  return (
    <button
      type="button"
      data-tryon-trigger
      onClick={openMirror}
      aria-label={ready ? "Open the Mirror" : "Create your avatar"}
      className={cn("shoop-mpeek", className)}
    >
      <span className={cn("shoop-mpeek__frame", dressing && "is-live")}>
        {ready && thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" />
        ) : (
          <span className="shoop-mpeek__empty" aria-hidden>
            <BuildSilhouette width={14} />
          </span>
        )}
        {badge != null ? (
          <span className="shoop-mpeek__n">{badge}</span>
        ) : null}
      </span>
      <span className="shoop-mpeek__lbl">Mirror</span>
    </button>
  );
}
