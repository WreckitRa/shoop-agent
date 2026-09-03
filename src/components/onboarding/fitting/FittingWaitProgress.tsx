"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";

export type WaitStep = {
  /** Earliest elapsed ms when this step becomes active. */
  atMs: number;
  label: string;
  detail: string;
};

export const VERDICT_WAIT_STEPS: WaitStep[] = [
  {
    atMs: 0,
    label: "Locking your approved scan",
    detail: "Face, coloring, and what you confirmed — not guessing from the photo alone.",
  },
  {
    atMs: 8_000,
    label: "Matching body",
    detail: "Height, build, and silhouette so the advice actually fits.",
  },
  {
    atMs: 16_000,
    label: "Weighing what you wear",
    detail: "What you already love against the week ahead.",
  },
  {
    atMs: 28_000,
    label: "Writing your rules",
    detail: "The do / don’t lines that stay useful for months.",
  },
  {
    atMs: 40_000,
    label: "Sharpening the verdict",
    detail: "Almost there — stay here.",
  },
];

export const SCAN_WAIT_STEPS: WaitStep[] = [
  {
    atMs: 0,
    label: "Reading the photo",
    detail: "Checking coverage, lighting, and usable face/body signal.",
  },
  {
    atMs: 6_000,
    label: "Mapping coloring & features",
    detail: "Undertone, contrast, and what the camera can actually see.",
  },
  {
    atMs: 16_000,
    label: "Drafting what to confirm",
    detail: "You’ll review anything uncertain before we write the verdict.",
  },
];

function formatRemaining(ms: number, expectedMs: number): string {
  const left = Math.max(0, expectedMs - ms);
  const sec = Math.ceil(left / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s left`;
  return `${m}:${s.toString().padStart(2, "0")} left`;
}

/** Asymptotic bar — approaches ~92%, never claims 100% until done. */
function progressPct(elapsedMs: number, expectedMs: number): number {
  const t = Math.max(0, elapsedMs) / Math.max(1, expectedMs);
  return Math.min(92, Math.round((1 - Math.exp(-1.35 * t)) * 92));
}

function activeStepIndex(steps: WaitStep[], elapsedMs: number): number {
  let idx = 0;
  for (let i = 0; i < steps.length; i++) {
    if (elapsedMs >= steps[i]!.atMs) idx = i;
  }
  return idx;
}

export function FittingWaitProgress({
  steps,
  expectedMs = 55_000,
  className,
  compact = false,
}: {
  steps: WaitStep[];
  /** Soft expectation for the bar (not a hard timeout). */
  expectedMs?: number;
  className?: string;
  /** Phone stage overlay — current label + bar only. */
  compact?: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const active = activeStepIndex(steps, elapsedMs);
  const pct = progressPct(elapsedMs, expectedMs);
  const current = steps[active]!;

  if (compact) {
    return (
      <div
        className={cn(
          "rounded-[14px] border border-[var(--fitting-line)] bg-white/95 px-3 py-2.5 shadow-[0_10px_22px_-14px_rgba(14,14,17,.45)] backdrop-blur-[2px]",
          className,
        )}
        role="status"
        aria-live="polite"
        aria-busy
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={current.label}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="fitting-motion size-1.5 shrink-0 rounded-full bg-[var(--fitting-red)] [animation:fitting-blink_1.2s_ease-in-out_infinite]"
              aria-hidden
            />
            <span className="truncate font-display text-[11px] font-extrabold text-[var(--fitting-ink)]">
              {current.label}
            </span>
          </div>
          <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-[var(--fitting-quiet)]">
            {formatRemaining(elapsedMs, expectedMs)}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[#E9E9EE]" aria-hidden>
          <div
            className="fitting-motion h-full rounded-full bg-[var(--fitting-red)] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("mt-6 max-w-[360px]", className)}
      role="status"
      aria-live="polite"
      aria-busy
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={current.label}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="fitting-motion size-2 shrink-0 rounded-full bg-[var(--fitting-red)] [animation:fitting-blink_1.2s_ease-in-out_infinite]"
            aria-hidden
          />
          <span className="truncate font-display text-[10px] font-extrabold tracking-[0.12em] text-[var(--fitting-ink)]">
            STILL WORKING
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-[var(--fitting-quiet)]">
          {formatRemaining(elapsedMs, expectedMs)}
        </span>
      </div>

      <div
        className="mb-4 h-1.5 overflow-hidden rounded-full bg-[#E9E9EE]"
        aria-hidden
      >
        <div
          className="fitting-motion h-full rounded-full bg-[var(--fitting-red)] transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="m-0 list-none space-y-2.5 p-0">
        {steps.map((step, i) => {
          const done = i < active;
          const now = i === active;
          return (
            <li
              key={step.label}
              className={cn(
                "flex gap-2.5 transition-opacity duration-300",
                done || now ? "opacity-100" : "opacity-40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold",
                  done
                    ? "bg-[rgba(22,163,74,.14)] text-[var(--fitting-good)]"
                    : now
                      ? "bg-[rgba(228,40,49,.12)] text-[var(--fitting-red)]"
                      : "bg-[#EEEFF3] text-[var(--fitting-quiet)]",
                )}
                aria-hidden
              >
                {done ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-[12.5px] font-bold leading-tight",
                    now
                      ? "text-[var(--fitting-ink)]"
                      : done
                        ? "text-[var(--fitting-quiet)]"
                        : "text-[var(--fitting-quiet)]",
                  )}
                >
                  {step.label}
                  {now ? (
                    <span className="fitting-motion ml-1 inline-block tracking-[0.2em] text-[var(--fitting-red)] [animation:fitting-blink_1.2s_ease-in-out_infinite]">
                      …
                    </span>
                  ) : null}
                </div>
                {now ? (
                  <p className="mt-1 text-[11.5px] leading-[1.45] text-[var(--fitting-quiet)]">
                    {step.detail}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
