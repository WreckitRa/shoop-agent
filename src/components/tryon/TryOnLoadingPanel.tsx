"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export type TryOnLoadingVariant =
  | "avatar-upload"
  | "avatar-generate"
  | "avatar-save"
  | "dress-item"
  | "dress-look";

const COPY: Record<
  TryOnLoadingVariant,
  { title: string; subtitle: string; hints: string[]; estimate?: string }
> = {
  "avatar-upload": {
    title: "Uploading your photo",
    subtitle: "Saving your selfie so we can match your face.",
    hints: ["Uploading image…", "Preparing your draft…"],
    estimate: "Usually under 10 seconds",
  },
  "avatar-generate": {
    title: "Crafting your digital twin",
    subtitle: "Matching your face, then shaping the body from your picks.",
    hints: [
      "Studying your facial features…",
      "Sculpting height and build…",
      "Painting natural skin and fabric light…",
      "High-quality FASHN pass — almost ready…",
    ],
    estimate: "Usually 30–60 seconds",
  },
  "avatar-save": {
    title: "Saving your avatar",
    subtitle: "Storing your approved look so try-on is ready in search.",
    hints: ["Finalizing your avatar…"],
    estimate: "Just a moment",
  },
  "dress-item": {
    title: "Dressing this piece",
    subtitle: "Rendering the garment on your avatar — fit is approximate.",
    hints: [
      "Loading garment and avatar…",
      "Rendering with FASHN…",
      "Almost there — final touches…",
    ],
    estimate: "Usually under a minute",
  },
  "dress-look": {
    title: "Dressing your look",
    subtitle: "Layering each piece on your avatar one at a time.",
    hints: [
      "Starting with the base layer…",
      "Adding the next piece…",
      "Blending the outfit…",
      "Finishing the full look…",
    ],
    estimate: "Usually 2–6 minutes",
  },
};

type DressLookStep = {
  title?: string;
  status: string;
};

type TryOnLoadingPanelProps = {
  variant: TryOnLoadingVariant;
  compact?: boolean;
  className?: string;
  steps?: DressLookStep[];
};

function useRotatingHint(hints: string[], intervalMs = 4000) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (hints.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % hints.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [hints, intervalMs]);
  return hints[index] ?? hints[0];
}

function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return seconds;
}

function AvatarSkeleton() {
  return (
    <div
      className="relative mx-auto flex h-56 w-full max-w-[220px] items-end justify-center overflow-hidden rounded-2xl bg-surface-tint ring-1 ring-hairline"
      aria-hidden
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-surface-subtle/40 to-surface-tint motion-reduce:animate-none" />
      <svg viewBox="0 0 80 160" className="relative h-48 w-24 text-ink-soft/30">
        <ellipse cx="40" cy="18" rx="14" ry="16" fill="currentColor" />
        <rect x="28" y="34" width="24" height="48" rx="8" fill="currentColor" />
        <rect x="22" y="82" width="10" height="58" rx="4" fill="currentColor" />
        <rect x="48" y="82" width="10" height="58" rx="4" fill="currentColor" />
      </svg>
      <div className="absolute inset-x-4 bottom-4 h-2 animate-pulse rounded-full bg-ink/5 motion-reduce:animate-none" />
    </div>
  );
}

function GarmentSkeleton() {
  return (
    <div
      className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-tint ring-1 ring-hairline"
      aria-hidden
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-surface-subtle/60 via-surface-tint to-surface-subtle/40 motion-reduce:animate-none" />
      <div className="absolute inset-x-6 top-8 h-24 rounded-lg bg-ink/[0.04]" />
      <div className="absolute inset-x-10 bottom-10 h-3 rounded-full bg-ink/[0.06]" />
    </div>
  );
}

export function TryOnLoadingPanel({
  variant,
  compact = false,
  className,
  steps,
}: TryOnLoadingPanelProps) {
  const copy = COPY[variant];
  const hint = useRotatingHint(copy.hints);
  const elapsed = useElapsedSeconds();
  const showAvatarSkeleton =
    variant === "avatar-generate" ||
    variant === "avatar-upload" ||
    variant === "avatar-save";
  const showGarmentSkeleton = variant === "dress-item" || variant === "dress-look";

  const completedSteps = steps?.filter((s) => s.status === "completed").length ?? 0;
  const totalSteps = steps?.length ?? 0;
  const activeStep = steps?.find((s) => s.status === "processing");

  return (
    <div
      className={cn(
        "rounded-2xl border border-hairline bg-surface-tint/60 px-4 py-5",
        compact && "py-4",
        className,
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-tint">
          {variant.startsWith("avatar") ? (
            <UserRound className="size-5 text-brand" aria-hidden />
          ) : (
            <Sparkles className="size-5 text-brand" aria-hidden />
          )}
          <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-brand">
            <Loader2 className="size-3 animate-spin text-white" aria-hidden />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{copy.title}</p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">{copy.subtitle}</p>
        </div>
      </div>

      {showAvatarSkeleton ? (
        <div className="mt-4">
          <AvatarSkeleton />
        </div>
      ) : null}

      {showGarmentSkeleton ? (
        <div className="mt-4">
          <GarmentSkeleton />
        </div>
      ) : null}

      {totalSteps > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>
              Piece {Math.min(completedSteps + 1, totalSteps)} of {totalSteps}
              {activeStep?.title ? ` · ${activeStep.title}` : ""}
            </span>
            <span>
              {completedSteps}/{totalSteps}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{
                width: `${Math.max(8, (completedSteps / totalSteps) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <p className="text-xs text-ink-muted">{hint}</p>
        <p className="shrink-0 text-[10px] tabular-nums text-ink-muted">
          {elapsed}s · {copy.estimate}
        </p>
      </div>
    </div>
  );
}
