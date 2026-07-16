"use client";

import type { RenderLook } from "@/lib/fashion-memory/types/render-contract";
import { useTryOnDrawerStore } from "./tryon-drawer-store";
import {
  resolveTryonCta,
  useSelfAvatarStore,
} from "./self-avatar-store";

type LookTryon = NonNullable<RenderLook["tryon"]>;

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
  picksByRef: Record<
    string,
    {
      title: string;
      price?: { amount: number; currency: string };
      imageUrl?: string;
      productId?: string;
      preferredOptions?: Array<{ name: string; label: string }>;
      featuredVariant?: {
        id: string;
        price?: { amount: number; currency: string };
        checkoutUrl?: string;
        options?: Array<{ name: string; label: string }>;
      };
    }
  >;
  onOpenProduct: (ref: string) => void;
};

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
      s.session?.lookId === look.name &&
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
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft px-3 py-1 text-xs font-medium text-ink transition hover:bg-surface-tint"
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
            items: look.item_refs.map((ref) => ({
              ref,
              title: picksByRef[ref]?.title ?? ref,
              price: picksByRef[ref]?.price,
              imageUrl: picksByRef[ref]?.imageUrl,
              productId: picksByRef[ref]?.productId,
              preferredOptions: picksByRef[ref]?.preferredOptions,
              featuredVariant: picksByRef[ref]?.featuredVariant,
            })),
          })
        }
      >
        See look on you
      </button>
    </div>
  );
}
