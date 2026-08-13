"use client";

import type { RenderLook } from "@/lib/fashion-memory/types/render-contract";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";
import { useToastStore } from "@/lib/client/toast-store";
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
  const addManyToFittingRoom = useTryOnDrawerStore(
    (s) => s.addManyToFittingRoom,
  );
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const avatarStatus = useSelfAvatarStore((s) => s.status);
  const showToast = useToastStore((s) => s.show);
  const busy = useTryOnDrawerStore(
    (s) =>
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
      <button
        type="button"
        className="shoop-seeyou"
        onClick={() => openCreateFlow()}
      >
        <span className="shoop-seeyou__txt">
          Create
          <br />
          your twin
        </span>
        <svg className="shoop-seeyou__tri" viewBox="0 0 34 46" aria-hidden>
          <polygon points="2,2 32,23 2,44" fill="currentColor" />
        </svg>
      </button>
    );
  }

  const hangLook = () => {
    const items = lookItemsForFittingRoom({ look, searchId, picksByRef });
    if (!items.length) return;
    const result = addManyToFittingRoom(items);
    if (result.added > 0) {
      showToast({
        title:
          result.added === 1
            ? "Hung in the fitting room"
            : `Hung ${result.added} pieces`,
        body: "Open Mirror when you want them on.",
      });
      return;
    }
    if (result.full) {
      showToast({
        title: "Fitting room is full",
        body: "Take something off the rail first.",
      });
      return;
    }
    showToast({
      title: "Already hanging",
      body: "Those pieces are on the rail — open Mirror to wear them.",
    });
  };

  return (
    <>
      <button
        type="button"
        className="shoop-hanglook"
        onClick={hangLook}
      >
        Hang look
      </button>
      <button
        type="button"
        data-tryon-trigger
        className="shoop-seeyou"
        disabled={busy}
        aria-label={busy ? "Dressing this look" : "See this look on you"}
        onClick={() =>
          openLookTryOn({
            searchId,
            lookId: look.name,
            title: look.name,
            items: lookItemsForFittingRoom({ look, searchId, picksByRef }),
          })
        }
      >
        <span className="shoop-seeyou__txt">
          {busy ? (
            <>
              Dressing
              <br />
              you…
            </>
          ) : (
            <>
              See it
              <br />
              on you
            </>
          )}
        </span>
        <svg className="shoop-seeyou__tri" viewBox="0 0 34 46" aria-hidden>
          <polygon points="2,2 32,23 2,44" fill="currentColor" />
        </svg>
      </button>
    </>
  );
}
