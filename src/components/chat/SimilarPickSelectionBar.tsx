"use client";

import { ArrowRight, Sparkles, X } from "lucide-react";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";
import { MAX_FIND_SIMILAR_SEEDS } from "@/lib/ai-chat/search/find-similar/types";

export function SimilarPickSelectionBar({
  sourceMessageId,
  className,
}: {
  sourceMessageId: string;
  className?: string;
}) {
  const selection = useChatStore((s) => s.similarPickSelection);
  const clear = useChatStore((s) => s.clearSimilarPickSelection);
  const submit = useChatStore((s) => s.submitSimilarPickSelection);
  const isStreaming = useChatStore((s) => s.isStreaming);

  if (
    !selection ||
    selection.sourceMessageId !== sourceMessageId ||
    selection.picks.length === 0
  ) {
    return null;
  }

  const count = selection.picks.length;
  const atMax = count >= MAX_FIND_SIMILAR_SEEDS;
  const busy = isStreaming;
  const canSubmit = count > 0 && !busy;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/25 bg-brand/[0.06] px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          {count === 1
            ? "1 item selected for similar search"
            : `${count} items selected for similar search`}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          {atMax
            ? `Maximum ${MAX_FIND_SIMILAR_SEEDS} — tap Find similar to swap picks.`
            : `Select up to ${MAX_FIND_SIMILAR_SEEDS}, then explore.`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={clear}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-ink-muted transition hover:bg-surface-page/80 hover:text-ink disabled:opacity-50"
        >
          <X className="size-3.5" aria-hidden />
          Clear
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="size-3.5" strokeWidth={2.25} aria-hidden />
          Find similar{count > 1 ? ` (${count})` : ""}
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
