"use client";

import { Reply, X } from "lucide-react";
import type { ComposerReplyContext } from "@/lib/ai-chat/composer-reply-context";
import { composerReplyPreviewLabel } from "@/lib/ai-chat/composer-reply-context";
import { cn } from "@/lib/ai-chat/cn";

export function ComposerReplyChip({
  context,
  onRemove,
  className,
  readOnly = false,
}: {
  context: ComposerReplyContext;
  onRemove?: () => void;
  className?: string;
  /** When true, shows the quoted pick without a dismiss control (sent messages). */
  readOnly?: boolean;
}) {
  const label = composerReplyPreviewLabel(context);

  return (
    <div
      className={cn("shoop-composer-reply", className)}
      role="status"
      aria-label={`Replying about ${context.title}`}
    >
      <Reply
        className="shoop-composer-reply__icon size-3.5 shrink-0"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="shoop-composer-reply__text min-w-0 flex-1">{label}</p>
      {!readOnly && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="shoop-composer-reply__dismiss flex size-6 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-tint hover:text-ink"
          aria-label="Remove reply context"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
