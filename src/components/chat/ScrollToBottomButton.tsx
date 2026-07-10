"use client";

import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export function ScrollToBottomButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest messages"
      className={cn(
        "pointer-events-auto flex size-10 items-center justify-center rounded-full border border-hairline bg-white text-ink shadow-[0_4px_20px_-4px_rgba(15,23,42,0.2)] transition hover:bg-slate-50 active:scale-95",
        className,
      )}
    >
      <ArrowDown className="size-4" strokeWidth={2.25} aria-hidden />
    </button>
  );
}
