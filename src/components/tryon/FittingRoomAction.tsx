"use client";

import type { MouseEvent } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { useToastStore } from "@/lib/client/toast-store";
import { useAppSessionStore } from "@/lib/client/app-session";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";
import { useTryOnDrawerStore } from "./tryon-drawer-store";
import {
  resolveTryonCta,
  useSelfAvatarStore,
} from "./self-avatar-store";
import {
  accessNeedsAccountForMirror,
  guestFittingCtaLabel,
} from "./mirror-entry";
import { requestMirror } from "./request-mirror";

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
  const accessMode = useAppSessionStore((s) => s.mode);
  const needsAccount = accessNeedsAccountForMirror(accessMode);

  const cta = resolveTryonCta({
    available: tryonAvailable ?? item.tryonSupported,
    cta: tryonCta === "create_avatar" ? "create_avatar" : undefined,
    avatarStatus,
  });

  if (cta === "hidden") return null;

  if (needsAccount) {
    const guestLabel = guestFittingCtaLabel(
      variant === "overlay" ? "overlay" : "button",
    );
    const startOnboarding = (e: MouseEvent) => {
      e.stopPropagation();
      requestMirror();
    };
    if (variant === "overlay") {
      return (
        <div className={cn("shoop-tryb-row", className)}>
          <button
            type="button"
            data-tryon-trigger
            className="shoop-tryb"
            aria-label={guestFittingCtaLabel("button")}
            onClick={startOnboarding}
          >
            {guestLabel}
          </button>
        </div>
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
        onClick={startOnboarding}
      >
        {guestLabel}
      </button>
    );
  }

  if (cta === "create_avatar") {
    if (variant === "overlay") {
      return (
        <div className={cn("shoop-tryb-row", className)}>
          <button
            type="button"
            data-tryon-trigger
            className="shoop-tryb"
            onClick={(e) => {
              e.stopPropagation();
              openCreateFlow();
            }}
          >
            CREATE AVATAR →
          </button>
        </div>
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
  const showToast = useToastStore((s) => s.show);

  const overlayLabel = isActive
    ? "ON YOU"
    : blockedFull
      ? "ROOM FULL"
      : "ON YOU →";

  const label = isActive
    ? "On you"
    : blockedFull
      ? "Fitting room full"
      : "See it on you";

  const hangIt = (e: MouseEvent) => {
    e.stopPropagation();
    if (blockedFull) return;
    const result = addToFittingRoom(item);
    if (result === "added") {
      showToast({
        title: "Hung in the fitting room",
        body: "Open Mirror when you want it on.",
      });
      return;
    }
    if (result === "duplicate") {
      showToast({
        title: "Already hanging",
        body: "It's on the rail — open Mirror to wear it.",
      });
      return;
    }
    showToast({
      title: "Fitting room is full",
      body: "Take something off the rail first.",
    });
  };

  const dressNow = (e: MouseEvent) => {
    e.stopPropagation();
    if (isActive || blockedFull) return;
    addToFittingRoom(item);
    tryOnItem(item.id, { replaceSameType: true });
  };

  if (variant === "overlay") {
    return (
      <div className={cn("shoop-tryb-row", className)}>
        <button
          type="button"
          className="shoop-tryb shoop-tryb--hang"
          disabled={blockedFull}
          onClick={hangIt}
        >
          {isInRack ? "HANGING" : blockedFull ? "FULL" : "HANG IT"}
        </button>
        <button
          type="button"
          data-tryon-trigger
          disabled={isActive || blockedFull}
          className="shoop-tryb"
          onClick={dressNow}
        >
          {overlayLabel}
        </button>
      </div>
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
