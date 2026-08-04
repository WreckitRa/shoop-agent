"use client";

import { cn } from "@/lib/ai-chat/cn";

type Props = {
  show: boolean;
  /** Main headline HTML (allows &lt;em&gt; for red accents). */
  coverHtml: string;
  /** Small red line above the headline — "saving…", "next up…", etc. */
  statusLabel: string;
  /** Optional secondary line under the headline (what work is running). */
  detail?: string | null;
};

/**
 * Full-screen black loading interstitial for The Fitting.
 * Shown while real work runs (API saves, deck fetch, FASHN) — not a timed
 * decorative flash.
 */
export function FittingFlash({
  show,
  coverHtml,
  statusLabel,
  detail,
}: Props) {
  return (
    <div
      className={cn(
        "fitting-motion fixed inset-0 z-[120] grid place-items-center bg-[var(--fitting-ink)] transition-opacity duration-300",
        show
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0",
      )}
      role={show ? "status" : undefined}
      aria-live={show ? "polite" : undefined}
      aria-busy={show}
      aria-hidden={!show}
    >
      <div className="flex flex-col items-center px-[8vw]">
        <div className="mb-4 text-center text-xs font-bold tracking-[0.04em] text-[var(--fitting-red)]">
          {statusLabel}
        </div>
        <div
          className="text-center font-display text-[clamp(26px,3.6vw,44px)] font-extrabold leading-[1.1] tracking-[-0.01em] text-white"
          dangerouslySetInnerHTML={{ __html: coverHtml }}
        />
        {detail ? (
          <p className="mt-5 max-w-md text-center text-[12px] font-semibold tracking-[0.02em] text-[#8A8A93]">
            {detail}
          </p>
        ) : null}
        {show ? (
          <div
            className="mt-8 h-1 w-28 overflow-hidden rounded-full bg-white/10"
            aria-hidden
          >
            <div className="fitting-load-bar h-full w-1/2 rounded-full bg-[var(--fitting-red)]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
