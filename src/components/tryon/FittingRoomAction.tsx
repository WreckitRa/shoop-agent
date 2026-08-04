"use client";

import { cn } from "@/lib/ai-chat/cn";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";
import { useTryOnDrawerStore } from "./tryon-drawer-store";
import {
  resolveTryonCta,
  useSelfAvatarStore,
} from "./self-avatar-store";

type FittingRoomActionProps = {
  item: FittingRoomItem;
  className?: string;
  compact?: boolean;
  /** When set, show create-avatar CTA from pick contract even if item is tryonSupported. */
  tryonAvailable?: boolean;
  tryonCta?: "tryon" | "create_avatar" | "hidden";
};

export function FittingRoomAction({
  item,
  className,
  compact = false,
  tryonAvailable,
  tryonCta,
}: FittingRoomActionProps) {
  const addToFittingRoom = useTryOnDrawerStore((s) => s.addToFittingRoom);
  const isInRack = useTryOnDrawerStore((s) => s.isInRack(item.id));
  const rackFull = useTryOnDrawerStore((s) => s.isRackFull());
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const avatarStatus = useSelfAvatarStore((s) => s.status);

  const cta = resolveTryonCta({
    available: tryonAvailable ?? item.tryonSupported,
    cta: tryonCta === "create_avatar" ? "create_avatar" : undefined,
    avatarStatus,
  });

  if (cta === "hidden") return null;

  if (cta === "create_avatar") {
    return (
      <button
        type="button"
        data-tryon-trigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-xs font-medium text-ink transition hover:bg-surface-tint",
          compact && "px-2.5 py-0.5 text-[11px]",
          className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          openCreateFlow();
        }}
      >
        Create your avatar to try it on
      </button>
    );
  }

  const label =
    isInRack ? "In fitting room"
    : rackFull ? "Fitting room full"
    : "Add to fitting room";

  return (
    <button
      type="button"
      data-tryon-trigger
      disabled={isInRack || rackFull}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-default disabled:opacity-60",
        isInRack
          ? "border-success/30 bg-success-tint text-success-dark"
          : "border-hairline text-ink hover:bg-surface-tint",
        compact && "px-2.5 py-0.5 text-[11px]",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        addToFittingRoom(item);
      }}
    >
      {label}
    </button>
  );
}
