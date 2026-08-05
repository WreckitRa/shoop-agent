"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Receipt, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

const NOTICE_COPY = {
  title: "Coming soon",
  body: "Drop a receipt and Shoop checks if your items qualify for price-drop refunds, then gets that money back for you. We take 20%, capped at $20.",
};

export function ReceiptPlusButton({
  variant = "default",
}: {
  variant?: "default" | "door";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const close = useCallback(() => setNoticeOpen(false), []);

  useEffect(() => {
    if (!noticeOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const timer = window.setTimeout(close, 8000);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [noticeOpen, close]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-expanded={noticeOpen}
        aria-label="Upload refund receipt"
        onClick={() => setNoticeOpen((v) => !v)}
        className={
          variant === "door"
            ? cn("shoop-ask-door", noticeOpen && "bg-surface-tint text-ink")
            : cn(
                "inline-flex items-center gap-1.5 rounded-full border border-dashed border-hairline bg-transparent py-1.5 pl-2.5 pr-3 text-[13px] font-medium text-ink-secondary transition",
                noticeOpen
                  ? "border-ink/25 bg-surface-tint text-ink"
                  : "hover:border-ink/20 hover:bg-surface-tint/70",
              )
        }
      >
        {variant === "door" ? (
          <>🧾 Receipt</>
        ) : (
          <>
            <Receipt className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="hidden xs:inline sm:inline">Receipt</span>
            <Plus
              className="size-3 shrink-0 opacity-60"
              strokeWidth={1.75}
              aria-hidden
            />
          </>
        )}
      </button>

      {noticeOpen ? (
        <div
          role="status"
          aria-live="polite"
          className="shoop-receipt-notice absolute bottom-[calc(100%+10px)] left-0 z-[60] w-[min(300px,calc(100vw-2rem))]"
        >
          <div className="flex gap-2.5 rounded-2xl border border-hairline bg-white p-3 shadow-card">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft">
              <Sparkles
                className="size-4 text-brand"
                strokeWidth={1.75}
                aria-hidden
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug text-ink">
                {NOTICE_COPY.title}
              </p>
              <p className="mt-1 text-[12px] leading-[1.45] text-ink-secondary">
                {NOTICE_COPY.body}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Dismiss"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-tint hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
