"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ShoopLogo } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import { FittingMirror } from "./FittingMirror";
import { FittingTracker } from "./FittingTracker";
import { FittingTraceBadge } from "./FittingTraceBadge";
import { postFittingTraceEvent } from "./fitting-trace-log";
import { ensureFittingTraceId } from "./fitting-trace-id";
import { type FittingStep, type MirrorState } from "./types";

type Props = {
  step: FittingStep;
  progressPct: number;
  stageLabel: string;
  stepCountLabel: string;
  mirror: MirrorState;
  children: ReactNode;
  onTell?: (text: string) => void;
  tellFeedback?: string | null;
  tellBusy?: boolean;
  /** Page = full-screen Fitting. Column = Mirror-rail host on chat/home. */
  layout?: "page" | "column";
  onPickPhoto?: (file: File) => void;
  photoPickLocked?: boolean;
  onRetryTwin?: () => void;
  onDismiss?: () => void;
  /** Verdict card: looks rail lives in the step — don't stretch the twin. */
  hideMirror?: boolean;
  /**
   * Mobile page only: the twin card IS the wait screen (scan / verdict wait).
   * Check / review is a normal form — keep children in one tree so toggling this
   * does not remount the panel. Desktop rail is unchanged.
   */
  phoneStage?: boolean;
  /** Twin-ready celebration — sits on the onboarding page, not beside it. */
  overlay?: ReactNode;
};

export function TwinReadyOverlay({
  avatarUrl,
}: {
  avatarUrl: string | null;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/94 px-8 lg:hidden"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-[260px] overflow-hidden rounded-[22px] border border-[var(--fitting-line)] bg-[#F4F4F6] shadow-[0_24px_60px_-24px_rgba(14,14,17,.45)]">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="aspect-[3/4] w-full object-cover object-top animate-[fitting-twin-in_0.7s_ease-out]"
          />
        ) : (
          <div className="aspect-[3/4] w-full bg-[#E8E8EC]" />
        )}
      </div>
      <p className="mt-5 flex items-center gap-2 font-display text-[15px] font-extrabold tracking-[-0.02em] text-[var(--fitting-ink)]">
        <span
          className="size-2 shrink-0 rounded-full bg-[#2BB673]"
          aria-hidden
        />
        Your avatar has been created
      </p>
    </div>
  );
}

export function FittingShell({
  step,
  progressPct,
  stageLabel,
  stepCountLabel,
  mirror,
  children,
  onTell,
  tellFeedback,
  tellBusy,
  layout = "page",
  onPickPhoto,
  photoPickLocked = false,
  onRetryTwin,
  onDismiss,
  hideMirror = false,
  phoneStage = false,
  overlay = null,
}: Props) {
  const column = layout === "column";
  const reveal = step === "verdict";
  const scrollRef = useRef<HTMLDivElement>(null);
  const renderMirror = (mirrorLayout: "column" | "stage" = "column") =>
    hideMirror ? null : (
      <FittingMirror
        layout={mirrorLayout}
        mirror={mirror}
        onTell={step === "verdict" ? undefined : onTell}
        tellFeedback={tellFeedback}
        tellBusy={tellBusy}
        onPickPhoto={onPickPhoto}
        photoPickLocked={photoPickLocked}
        onRetryTwin={onRetryTwin}
      />
    );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [step]);

  useEffect(() => {
    ensureFittingTraceId();
    postFittingTraceEvent("step", { step, layout, stageLabel });
  }, [step, layout, stageLabel]);

  return (
    <div
      className={
        column
          ? "relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-[var(--fitting-ink)] selection:bg-[var(--fitting-red)] selection:text-white"
          : "fixed inset-0 z-[100] bg-white text-[var(--fitting-ink)] selection:bg-[var(--fitting-red)] selection:text-white lg:bg-[rgba(14,14,17,0.4)] lg:p-4"
      }
    >
      {column ? (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden min-h-0 w-[156px] shrink-0 border-r border-[var(--fitting-line)] xl:flex xl:flex-col">
            <FittingTracker
              step={step}
              mirror={mirror}
              progressPct={progressPct}
            />
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-4 py-3 pr-12 xl:hidden">
              <ShoopLogo className="h-[15px]" />
              <div className="text-[11px] font-semibold tracking-[0.02em] text-[var(--fitting-quiet)]">
                {stageLabel} ·{" "}
                <b className="text-[var(--fitting-ink)]">{stepCountLabel}</b>
              </div>
            </div>
            <div className="mx-4 mb-0 h-1 xl:hidden">
              <div className="h-1 overflow-hidden rounded-full bg-[var(--fitting-g3)]">
                <i
                  className="fitting-motion block h-full rounded-full bg-[var(--fitting-red)]"
                  style={{
                    width: `${progressPct}%`,
                    transition: "width 0.7s cubic-bezier(.4,0,.2,1)",
                  }}
                />
              </div>
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-6 pt-4 pr-12 lg:pr-6 [&_.fitting-count]:hidden"
            >
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative mx-auto flex h-full min-h-0 w-full max-w-[1400px] overflow-hidden bg-white max-lg:max-w-none lg:rounded-[22px] lg:border lg:border-[var(--fitting-line)] lg:shadow-[0_28px_80px_-18px_rgba(14,14,17,0.55)]">
          <aside className="hidden h-full min-h-0 w-[200px] shrink-0 overflow-y-auto border-r border-[var(--fitting-line)] lg:block">
            <FittingTracker
              step={step}
              mirror={mirror}
              progressPct={progressPct}
            />
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {reveal ? (
              <div
                className={cn(
                  "flex items-center gap-2.5 px-[18px] pb-2.5 pt-[max(10px,env(safe-area-inset-top))] lg:hidden",
                  !phoneStage && "border-b border-[var(--fitting-line)]",
                )}
              >
                <div className="font-display text-[16px] font-black tracking-[-0.02em] text-[var(--fitting-red)]">
                  SHOOP
                </div>
                <div className="text-[11.5px] font-semibold text-[var(--fitting-quiet)]">
                  Your reading
                </div>
                {onDismiss ? (
                  <button
                    type="button"
                    aria-label="Leave The Fitting"
                    onClick={onDismiss}
                    className="ml-auto grid size-8 place-items-center rounded-full text-[var(--fitting-quiet)]"
                  >
                    <span aria-hidden className="text-lg leading-none">
                      ×
                    </span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-3 px-[22px] pb-2 pt-[max(18px,calc(env(safe-area-inset-top)+18px))] lg:hidden">
                <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--fitting-g3)]">
                  <i
                    className="fitting-motion block h-full rounded-full bg-[var(--fitting-red)]"
                    style={{
                      width: `${progressPct}%`,
                      transition: "width 0.7s cubic-bezier(.32,.72,0,1)",
                    }}
                  />
                </div>
                <div className="font-display text-[11px] font-black tabular-nums text-[var(--fitting-quiet)]">
                  {Math.round(progressPct)}%
                </div>
                {onDismiss ? (
                  <button
                    type="button"
                    aria-label="Leave The Fitting"
                    onClick={onDismiss}
                    className="grid size-8 place-items-center rounded-full text-[var(--fitting-quiet)]"
                  >
                    <span aria-hidden className="text-lg leading-none">
                      ×
                    </span>
                  </button>
                ) : null}
              </div>
            )}
            <div className="relative min-h-0 flex-1">
              {phoneStage ? (
                <div className="absolute inset-0">{renderMirror("stage")}</div>
              ) : null}
              <div
                ref={scrollRef}
                className={
                  phoneStage
                    ? "pointer-events-none absolute inset-x-0 bottom-0 z-10 max-h-[min(72dvh,560px)] overflow-y-auto px-4 pb-[max(14px,env(safe-area-inset-bottom))]"
                    : cn(
                        "fitting-ob-scroll relative min-h-0 min-w-0 h-full overflow-x-hidden overflow-y-auto px-[22px] pt-4 sm:px-8 lg:px-10 lg:pb-8 lg:pt-8",
                        reveal
                          ? "pb-[max(24px,env(safe-area-inset-bottom))]"
                          : "pb-[max(110px,calc(88px+env(safe-area-inset-bottom)))]",
                      )
                }
              >
                {onDismiss && !phoneStage ? (
                  <button
                    type="button"
                    aria-label="Leave The Fitting"
                    onClick={onDismiss}
                    className="absolute right-4 top-4 z-20 hidden size-8 place-items-center rounded-full border border-[var(--fitting-line)] bg-white text-[var(--fitting-quiet)] transition hover:text-[var(--fitting-ink)] lg:grid"
                  >
                    <span aria-hidden className="text-lg leading-none">
                      ×
                    </span>
                  </button>
                ) : null}
                <div
                  className={
                    phoneStage ? "pointer-events-auto" : "fitting-ob-main"
                  }
                >
                  {children}
                </div>
              </div>
            </div>
          </div>
          {hideMirror ? null : (
            <div className="hidden h-full min-h-0 w-[min(300px,28vw)] shrink-0 overflow-hidden border-l border-[var(--fitting-line)] lg:block">
              {renderMirror()}
            </div>
          )}
          {overlay}
        </div>
      )}
      <FittingTraceBadge />
    </div>
  );
}
