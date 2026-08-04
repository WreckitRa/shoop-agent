"use client";

import type { ReactNode } from "react";
import { ShoopLogo } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import { FittingMirror } from "./FittingMirror";
import {
  SEWN_PCT,
  STITCH_KNOTS,
  type FittingStep,
  type MirrorState,
  knotNowIndex,
  sewnThroughIndex,
} from "./types";

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
}: Props) {
  const nowIdx = knotNowIndex(step);
  const sewnIdx = sewnThroughIndex(step);
  const sewnHeight =
    sewnIdx < 0
      ? SEWN_PCT[nowIdx] ?? 3
      : SEWN_PCT[Math.max(sewnIdx, nowIdx)] ?? 3;

  return (
    <div className="fixed inset-0 z-[100] overflow-x-hidden overflow-y-auto bg-gradient-to-b from-white to-[#F7F7F9] text-[var(--fitting-ink)] selection:bg-[var(--fitting-red)] selection:text-white">
      <div className="relative z-[5] flex items-center justify-between px-6 py-[22px] sm:px-10">
        <ShoopLogo className="h-[22px]" />
        <div className="flex items-center gap-3.5 text-xs font-semibold tracking-[0.02em] text-[var(--fitting-quiet)]">
          {stageLabel} ·{" "}
          <b className="text-[var(--fitting-ink)]">{stepCountLabel}</b>
        </div>
      </div>

      <div className="relative mx-6 mb-1.5 h-1.5 rounded-full bg-[var(--fitting-line)] sm:mx-10">
        <span
          className="fitting-motion absolute top-[-24px] z-[3] -translate-x-full whitespace-nowrap font-display text-base font-black text-[var(--fitting-red)] transition-[left] duration-700"
          style={{
            left: `${Math.max(8, progressPct)}%`,
            transitionTimingFunction: "cubic-bezier(.6,0,.2,1)",
          }}
        >
          {progressPct}%
        </span>
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <i
            className="fitting-motion absolute bottom-0 left-0 top-0 rounded-full bg-gradient-to-r from-[var(--fitting-red)] to-[#FF5A62] transition-[width] duration-700"
            style={{
              width: `${progressPct}%`,
              transitionTimingFunction: "cubic-bezier(.6,0,.2,1)",
            }}
          />
        </div>
      </div>

      <div className="mx-auto grid min-h-[calc(100dvh-90px)] max-w-[1280px] grid-cols-1 gap-0 px-4 pb-12 pt-2 md:grid-cols-[48px_1fr] md:px-6 lg:grid-cols-[64px_1fr_372px] lg:px-10">
        {/* stitch rail */}
        <div className="relative hidden md:block">
          <div
            className="absolute bottom-0 left-[31px] top-0 w-0.5"
            style={{
              background:
                "repeating-linear-gradient(180deg,transparent 0 6px,var(--fitting-line) 6px 14px)",
            }}
          />
          <div
            className="fitting-motion absolute left-[31px] top-0 w-0.5 transition-[height] duration-[900ms]"
            style={{
              height: `${sewnHeight}%`,
              background:
                "repeating-linear-gradient(180deg,var(--fitting-red) 0 9px,transparent 9px 14px)",
              transitionTimingFunction: "cubic-bezier(.6,0,.2,1)",
            }}
          />
          {STITCH_KNOTS.map((knot, i) => {
            const tied = sewnIdx >= i;
            const now = nowIdx === i && !tied;
            return (
              <div
                key={knot.id}
                className={cn(
                  "fitting-motion absolute left-6 h-4 w-4 rounded-full border-[2.5px] border-[var(--fitting-line)] bg-white transition-all duration-300",
                  tied &&
                    "border-[var(--fitting-red)] bg-[var(--fitting-red)] shadow-[0_0_0_5px_rgba(228,40,49,0.12)]",
                  now &&
                    "animate-[fitting-kpulse_1.6s_ease_infinite] !border-[3px] !border-[var(--fitting-red)] !bg-white",
                )}
                style={{ top: knot.top }}
              >
                <span
                  className={cn(
                    "absolute left-[26px] top-[-2px] whitespace-nowrap text-[10px] font-bold tracking-[0.02em] text-[#C9C9CF] transition-colors",
                    (tied || now) && "text-[var(--fitting-ink)]",
                    now && "font-extrabold",
                    "emphasis" in knot &&
                      knot.emphasis &&
                      "text-[var(--fitting-red)]",
                  )}
                >
                  {"emphasis" in knot && knot.emphasis ? (
                    <em className="not-italic text-[var(--fitting-red)]">
                      {knot.label}
                    </em>
                  ) : (
                    knot.label
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* question stage */}
        <div className="relative px-2 pb-8 pt-4 md:px-8 md:pl-12 lg:px-14 lg:pl-[90px] lg:pt-[30px]">
          {children}
        </div>

        {/* mirror */}
        <div className="hidden lg:block">
          <FittingMirror
            mirror={mirror}
            onTell={step === "verdict" ? undefined : onTell}
            tellFeedback={tellFeedback}
            tellBusy={tellBusy}
          />
        </div>
      </div>
    </div>
  );
}
