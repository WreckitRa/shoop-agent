"use client";

import { useCallback } from "react";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";
import type { CuratedPick, ProductCard } from "@/lib/ai-chat/types";

function formatPriceLabel(product: ProductCard): string | null {
  const single = product.displayPrice ?? product.featuredVariant?.price;
  if (single) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: single.currency,
        maximumFractionDigits: single.amount % 100 === 0 ? 0 : 2,
      }).format(single.amount / 100);
    } catch {
      return null;
    }
  }
  const r = product.priceRange;
  if (!r) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: r.min.currency,
      maximumFractionDigits: r.min.amount % 100 === 0 ? 0 : 2,
    }).format(r.min.amount / 100);
  } catch {
    return null;
  }
}

/** Adds this pick as composer context for the next "Ask Shoop" message. */
export function PickReplyButton({
  pick,
  className,
}: {
  pick: CuratedPick | ProductCard;
  className?: string;
}) {
  const messageId = useChatMessageProductLink();
  const replyToPick = useChatStore((s) => s.replyToPick);
  const activeReply = useChatStore((s) => s.composerReplyContext);
  const isActive =
    activeReply?.productId === pick.id &&
    activeReply?.sourceMessageId === messageId;

  const onReply = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!messageId) return;
      replyToPick(pick, messageId, formatPriceLabel(pick));
    },
    [messageId, pick, replyToPick],
  );

  if (!messageId) return null;

  return (
    <button
      type="button"
      onClick={onReply}
      aria-label={`Ask Shoop about ${pick.title}`}
      aria-pressed={isActive}
      className={cn(
        "group inline-flex h-7 min-w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface/95 px-1.5 shadow-sm backdrop-blur-sm transition-[gap,padding,border-color,background-color,justify-content] duration-200 ease-out hover:justify-start hover:gap-1.5 hover:border-ink/20 hover:bg-surface-tint hover:px-2.5",
        isActive &&
          "justify-start gap-1.5 border-ink/25 bg-ink text-white px-2.5",
        className,
      )}
    >
      <ShoopIcon size={16} className="block shrink-0" />
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-[11px] font-medium leading-none text-ink-secondary transition-[max-width,opacity] duration-200 ease-out",
          "max-w-0 opacity-0",
          "group-hover:max-w-[4.75rem] group-hover:opacity-100 group-hover:text-ink",
          isActive && "max-w-[4.75rem] opacity-100 text-white",
        )}
      >
        Ask Shoop
      </span>
    </button>
  );
}
