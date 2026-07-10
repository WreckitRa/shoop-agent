"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export function ConversationSearch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 px-2", className)}>
      <div className="flex h-9 items-center gap-1.5 rounded-xl border border-hairline bg-white px-2.5 shadow-soft">
        <Search
          className="size-[13px] shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search chats..."
          aria-label="Search recent chats"
          className="min-w-0 flex-1 border-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="shrink-0 rounded-lg p-0.5 text-ink-muted hover:text-ink"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
