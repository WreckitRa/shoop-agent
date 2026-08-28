"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ShoopLogo } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import { FittingMirror } from "./FittingMirror";
import { FittingTracker } from "./FittingTracker";
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
};

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
  photoPickLocked,
  onRetryTwin,
}: Props) {
  const column = layout === "column";
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [step]);

  return (
    <div
      className={
        column
          ? "relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-[var(--fitting-ink)] selection:bg-[var(--fitting-red)] selection:text-white"
          : "fixed inset-0 z-[110] overflow-x-hidden overflow-y-auto bg-white text-[var(--fitting-ink)] selection:bg-[var(--fitting-red)] selection:text-white"
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
        <div className="mx-auto grid min-h-[100dvh] max-w-[1400px] grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_minmax(260px,300px)]">
          <aside className="hidden min-h-0 border-r border-[var(--fitting-line)] lg:block">
            <FittingTracker
              step={step}
              mirror={mirror}
              progressPct={progressPct}
            />
          </aside>
          <div
            ref={scrollRef}
            className="relative min-w-0 px-5 pb-8 pt-6 sm:px-8 lg:px-10 lg:pt-8"
          >
            {children}
          </div>
          <div className="hidden min-w-0 lg:block">
            <FittingMirror
              mirror={mirror}
              onTell={step === "verdict" ? undefined : onTell}
              tellFeedback={tellFeedback}
              tellBusy={tellBusy}
              onPickPhoto={onPickPhoto}
              photoPickLocked={photoPickLocked}
              onRetryTwin={onRetryTwin}
            />
          </div>
        </div>
      )}
    </div>
  );
}
