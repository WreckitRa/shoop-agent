"use client";

import { Check, Sparkles } from "lucide-react";
import { useCallback } from "react";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";
import { MAX_FIND_SIMILAR_SEEDS } from "@/lib/ai-chat/search/find-similar/types";
import type { CuratedPick, ProductCard } from "@/lib/ai-chat/types";

function pickUpid(pick: CuratedPick | ProductCard): string | undefined {
  return "upid" in pick ? pick.upid : undefined;
}

/** Toggle this pick in the multi-select find-similar set (submit via selection bar). */
export function PickFindSimilarButton({
  pick,
  className,
  compact = false,
}: {
  pick: CuratedPick | ProductCard;
  className?: string;
  compact?: boolean;
}) {
  const messageId = useChatMessageProductLink();
  const toggleSimilarPick = useChatStore((s) => s.toggleSimilarPick);
  const selection = useChatStore((s) => s.similarPickSelection);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const isSelected =
    Boolean(messageId) &&
    selection?.sourceMessageId === messageId &&
    selection.picks.some((p) => p.productId === pick.id);

  const atCap =
    Boolean(messageId) &&
    selection?.sourceMessageId === messageId &&
    selection.picks.length >= MAX_FIND_SIMILAR_SEEDS &&
    !isSelected;

  const onToggle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!messageId || isStreaming || atCap) return;
      toggleSimilarPick(
        {
          productId: pick.id,
          title: pick.title,
          upid: pickUpid(pick),
        },
        messageId,
      );
    },
    [atCap, isStreaming, messageId, pick, toggleSimilarPick],
  );

  if (!messageId) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isStreaming || atCap}
      aria-label={
        isSelected
          ? `Remove ${pick.title} from similar search`
          : `Select ${pick.title} for similar search`
      }
      aria-pressed={isSelected}
      className={cn(
        "flex w-full shrink-0 items-center justify-center gap-1 border-t border-hairline-soft text-[10px] font-medium tracking-[0.04em] transition disabled:cursor-not-allowed disabled:opacity-45",
        compact ? "px-2 py-1.5" : "px-3 py-2",
        isSelected
          ? "bg-ink text-white hover:bg-ink/90"
          : "bg-transparent text-ink-muted hover:bg-warm/80 hover:text-ink",
        className,
      )}
    >
      {isSelected ? (
        <Check className="size-3 shrink-0" strokeWidth={2} aria-hidden />
      ) : (
        <Sparkles className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
      )}
      <span className="truncate">
        {isSelected ? "Selected" : compact ? "Similar" : "Find similar"}
      </span>
    </button>
  );
}
