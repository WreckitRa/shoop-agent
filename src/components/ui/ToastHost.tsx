"use client";

import { Sparkles, X } from "lucide-react";
import { useToastStore } from "@/lib/client/toast-store";
import { cn } from "@/lib/ai-chat/cn";

export function ToastHost() {
  const toast = useToastStore((s) => s.toast);
  const hide = useToastStore((s) => s.hide);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "pointer-events-none fixed bottom-6 left-1/2 z-[100] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 transition-all duration-300 ease-out",
        toast ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
    >
      {toast ? (
        <div className="pointer-events-auto overflow-hidden rounded-[22px] border border-hairline bg-white shadow-lift">
          <div className="flex items-start gap-3 px-4 py-3.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-white">
              {toast.emoji ? (
                <span className="text-[15px] leading-none" aria-hidden>
                  {toast.emoji}
                </span>
              ) : (
                <Sparkles
                  className="size-3.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {toast.title}
              </p>
              <p className="mt-1 text-[12px] leading-[1.45] text-ink-secondary">
                {toast.body}
              </p>
            </div>
            <button
              type="button"
              onClick={hide}
              aria-label="Dismiss"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-tint hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <div className="h-0.5 bg-surface-tint">
            <div className="h-full origin-left animate-[shoop-toast-progress_4.5s_linear_forwards] bg-ink" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
