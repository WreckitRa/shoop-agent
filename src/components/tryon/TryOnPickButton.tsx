"use client";

import type { RenderPick } from "@/lib/fashion-memory/types/render-contract";
import { useTryOnDrawerStore } from "./tryon-drawer-store";
import {
  resolveTryonCta,
  useSelfAvatarStore,
} from "./self-avatar-store";

type TryOnPickButtonProps = {
  pick: RenderPick;
  searchId: string;
  onImageReady?: (imageUrl: string, jobId: string) => void;
};

export function TryOnPickButton({ pick, searchId }: TryOnPickButtonProps) {
  const openItemTryOn = useTryOnDrawerStore((s) => s.openItemTryOn);
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const avatarStatus = useSelfAvatarStore((s) => s.status);
  const busy = useTryOnDrawerStore(
    (s) =>
      s.open &&
      s.session?.ref === pick.ref &&
      (s.status === "starting" ||
        s.status === "processing" ||
        s.status === "loading_avatar"),
  );

  const cta = resolveTryonCta({
    available: pick.tryon?.available,
    cta: pick.tryon?.cta,
    avatarStatus,
  });

  if (cta === "hidden") return null;

  if (cta === "create_avatar") {
    return (
      <div className="mt-2">
        <button
          type="button"
          data-tryon-trigger
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft px-3 py-1 text-xs font-medium text-ink transition hover:bg-surface-tint"
          onClick={(e) => {
            e.stopPropagation();
            openCreateFlow();
          }}
        >
          Create your avatar to try it on
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        data-tryon-trigger
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          openItemTryOn({
            searchId,
            ref: pick.ref,
            title: pick.title,
            imageUrl: pick.imageUrl,
            price: pick.displayPrice,
            productId: pick.id,
            preferredOptions: pick.preferredOptions,
            featuredVariant: pick.featuredVariant,
            badges: pick.badges,
          });
        }}
      >
        See it on you
      </button>
    </div>
  );
}
