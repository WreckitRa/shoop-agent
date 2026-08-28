"use client";

import { cn } from "@/lib/ai-chat/cn";

type Props = {
  show: boolean;
  /** Small status line — "saving…", "finishing…", etc. */
  statusLabel: string;
  /** Optional secondary line under the status. */
  detail?: string | null;
  layout?: "page" | "column";
  /**
   * @deprecated Kept for call-site compatibility; the minimal pill no longer
   * renders the full headline cover.
   */
  coverHtml?: string;
};

/**
 * Non-blocking status pill for The Fitting.
 * Sits over the column/page without eating clicks on the form.
 */
export function FittingFlash({
  show,
  statusLabel,
  detail,
  layout = "page",
}: Props) {
  const column = layout === "column";
  return (
    <div
      className={cn(
        "fitting-motion pointer-events-none z-10 flex justify-center transition-all duration-300",
        column
          ? "absolute inset-x-2.5 bottom-2.5"
          : "fixed inset-x-0 bottom-6",
        show
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0",
      )}
      role={show ? "status" : undefined}
      aria-live={show ? "polite" : undefined}
      aria-busy={show}
      aria-hidden={!show}
    >
      <div className="flex max-w-[min(100%,22rem)] items-center gap-2.5 rounded-full border border-[var(--fitting-line)] bg-white/95 px-3.5 py-2 shadow-[0_10px_28px_-14px_rgba(14,14,17,0.4)] backdrop-blur-sm">
        <div
          className="h-1 w-9 shrink-0 overflow-hidden rounded-full bg-[#E9E9EE]"
          aria-hidden
        >
          {show ? (
            <div className="fitting-load-bar h-full w-1/2 rounded-full bg-[var(--fitting-red)]" />
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[10px] font-extrabold tracking-[0.08em] text-[var(--fitting-ink)]">
            {statusLabel}
          </div>
          {detail ? (
            <p className="truncate text-[10px] font-semibold tracking-[0.02em] text-[var(--fitting-quiet)]">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
