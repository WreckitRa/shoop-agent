"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/ai-chat/cn";
import {
  CATALOG_IMAGE_PX,
  catalogDisplayImageUrl,
} from "@/lib/shopify/catalog-display-image";
import { FittingRoomAction } from "@/components/tryon/FittingRoomAction";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";

type Props = {
  domId?: string;
  title: string;
  imageUrl?: string;
  priceLabel?: string | null;
  meta?: string | null;
  selected?: boolean;
  compact?: boolean;
  muted?: boolean;
  /** Stretch to fill grid cells instead of fixed rack width. */
  fluid?: boolean;
  onOpen: () => void;
  fittingItem: FittingRoomItem;
  tryonAvailable?: boolean;
  tryonCta?: "tryon" | "create_avatar" | "hidden";
  /** Hide hover try-on overlay (e.g. look/capsule cards that use a section CTA). */
  hideTryOnOverlay?: boolean;
  className?: string;
  testId?: string;
  imagePriority?: boolean;
  imagePx?: number;
  footer?: ReactNode;
};

/**
 * Shared find card — matches FashionCurationResults rack (price pill + hover TRY ON ME).
 */
export function ShoopFindCard({
  domId,
  title,
  imageUrl,
  priceLabel,
  meta,
  selected = false,
  compact = false,
  muted = false,
  fluid = false,
  onOpen,
  fittingItem,
  tryonAvailable,
  tryonCta,
  hideTryOnOverlay = false,
  className,
  testId,
  imagePriority = false,
  imagePx = CATALOG_IMAGE_PX.scroll,
  footer,
}: Props) {
  return (
    <article
      className={cn(
        "shoop-vitem group/vitem",
        compact && "shoop-vitem--compact",
        selected && "shoop-vitem--selected",
        muted && "shoop-vitem--muted",
        fluid && "shoop-vitem--fluid",
        className,
      )}
      data-testid={testId}
    >
      <div className="shoop-vitem__im">
        <button
          type="button"
          id={domId}
          className="absolute inset-0 z-0 block size-full text-left"
          onClick={onOpen}
          aria-expanded={selected}
          aria-label={title}
        >
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={catalogDisplayImageUrl(imageUrl, imagePx)}
              alt=""
              loading={imagePriority ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={imagePriority ? "high" : undefined}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-ink-muted">
              {title.charAt(0) || "·"}
            </div>
          )}
        </button>
        {priceLabel ? (
          <span className="shoop-vitem__price">{priceLabel}</span>
        ) : null}
        {!hideTryOnOverlay ? (
          <FittingRoomAction
            item={fittingItem}
            variant="overlay"
            tryonAvailable={tryonAvailable}
            tryonCta={tryonCta}
          />
        ) : null}
      </div>
      <button
        type="button"
        className="shoop-vitem__why w-full text-left"
        onClick={onOpen}
        aria-expanded={selected}
      >
        <b>{title}</b>
        {meta ? <span className="shoop-vitem__meta">{meta}</span> : null}
      </button>
      {footer}
    </article>
  );
}
