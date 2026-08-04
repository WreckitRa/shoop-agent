"use client";

import type { RenderLook } from "@/lib/fashion-memory/types/render-contract";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";
import { fittingRoomItemFromSearchPick } from "./fitting-room-item-builders";
import { useTryOnDrawerStore } from "./tryon-drawer-store";
import {
  resolveTryonCta,
  useSelfAvatarStore,
} from "./self-avatar-store";

type LookTryon = NonNullable<RenderLook["tryon"]>;

type LookPickMeta = {
  title: string;
  price?: { amount: number; currency: string };
  imageUrl?: string;
  productId?: string;
  preferredOptions?: Array<{ name: string; label: string }>;
  featuredVariant?: FittingRoomItem["featuredVariant"];
  garment?: string;
};

type TryOnLookButtonProps = {
  look: {
    name: string;
    item_refs: string[];
    total: number;
    note?: string;
    tryon?: LookTryon;
    tryon_look?: RenderLook["tryon_look"];
  };
  searchId: string;
  picksByRef: Record<string, LookPickMeta>;
  onOpenProduct: (ref: string) => void;
};

export function lookItemsForFittingRoom(params: {
  look: { item_refs: string[] };
  searchId: string;
  picksByRef: Record<string, LookPickMeta>;
}): FittingRoomItem[] {
  const items: FittingRoomItem[] = [];
  for (const ref of params.look.item_refs) {
    const meta = params.picksByRef[ref];
    if (!meta?.productId) continue;
    items.push(
      fittingRoomItemFromSearchPick({
        searchId: params.searchId,
        pick: {
          ref,
          id: meta.productId,
          title: meta.title,
          imageUrl: meta.imageUrl,
          displayPrice: meta.price,
          preferredOptions: meta.preferredOptions,
          featuredVariant: meta.featuredVariant,
          garment: meta.garment,
          tryon: { available: true, disclaimer: TRYON_DISCLAIMER },
          badges: [],
        },
      }),
    );
  }
  return items;
}

export function TryOnLookButton({
  look,
  searchId,
  picksByRef,
}: TryOnLookButtonProps) {
  const openLookTryOn = useTryOnDrawerStore((s) => s.openLookTryOn);
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const avatarStatus = useSelfAvatarStore((s) => s.status);
  const busy = useTryOnDrawerStore(
    (s) =>
      s.open &&
      s.previewLookId === look.name &&
      (s.status === "starting" ||
        s.status === "processing" ||
        s.status === "loading_avatar"),
  );

  const cta = resolveTryonCta({
    available: look.tryon?.available,
    cta: look.tryon?.cta,
    avatarStatus,
  });

  if (cta === "hidden") return null;

  if (cta === "create_avatar") {
    return (
      <div className="mt-3">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-xs font-medium text-ink transition hover:bg-surface-tint"
          onClick={() => openCreateFlow()}
        >
          Create your avatar to try them on
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        data-tryon-trigger
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50"
        disabled={busy}
        onClick={() =>
          openLookTryOn({
            searchId,
            lookId: look.name,
            title: look.name,
            items: lookItemsForFittingRoom({ look, searchId, picksByRef }),
          })
        }
      >
        See look on you
      </button>
    </div>
  );
}
