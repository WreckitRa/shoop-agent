"use client";

import type { MouseEvent } from "react";
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
  /** Wireframe hover overlay on find cards */
  variant?: "default" | "overlay";
  /** When set, show create-avatar CTA from pick contract even if item is tryonSupported. */
  tryonAvailable?: boolean;
  tryonCta?: "tryon" | "create_avatar" | "hidden";
};

export function FittingRoomAction({
  item,
  className,
  compact = false,
  variant = "default",
  tryonAvailable,
  tryonCta,
}: FittingRoomActionProps) {
  const addToFittingRoom = useTryOnDrawerStore((s) => s.addToFittingRoom);
  const tryOnItem = useTryOnDrawerStore((s) => s.tryOnItem);
  const isInRack = useTryOnDrawerStore((s) => s.isInRack(item.id));
  const isActive = useTryOnDrawerStore((s) => s.isActive(item.id));
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
    if (variant === "overlay") {
      return (
        <button
          type="button"
          data-tryon-trigger
          className={cn("shoop-tryb", className)}
          onClick={(e) => {
            e.stopPropagation();
            openCreateFlow();
          }}
        >
          CREATE AVATAR →
        </button>
      );
    }
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

  const blockedFull = rackFull && !isInRack;

  const overlayLabel = isActive
    ? "ON YOU"
    : blockedFull
      ? "ROOM FULL"
      : "SEE IT ON YOU →";

  const label = isActive
    ? "On you"
    : blockedFull
      ? "Fitting room full"
      : "See it on you";

  const dressNow = (e: MouseEvent) => {
    e.stopPropagation();
    if (isActive || blockedFull) return;
    addToFittingRoom(item);
    // Dress immediately — don't make the user drag from the rail again.
    tryOnItem(item.id, { replaceSameType: true });
  };

  if (variant === "overlay") {
    return (
      <button
        type="button"
        data-tryon-trigger
        disabled={isActive || blockedFull}
        className={cn("shoop-tryb", className)}
        onClick={dressNow}
      >
        {overlayLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-tryon-trigger
      disabled={isActive || blockedFull}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-default disabled:opacity-60",
        isActive
          ? "border-success/30 bg-success-tint text-success-dark"
          : "border-hairline text-ink hover:bg-surface-tint",
        compact && "px-2.5 py-0.5 text-[11px]",
        className,
      )}
      onClick={dressNow}
    >
      {label}
    </button>
  );
}
