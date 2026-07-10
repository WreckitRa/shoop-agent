"use client";

import { Heart, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

type Variant = "deck" | "saving" | "card";

const COPY: Record<
  Variant,
  { title: string; subtitle: string; icon: typeof Sparkles }
> = {
  deck: {
    title: "Finding picks for you",
    subtitle: "We're choosing a few things based on what you told us — this won't take long.",
    icon: Sparkles,
  },
  saving: {
    title: "Almost there",
    subtitle: "Saving your taste so Shoop can shop smarter for you from the very first search.",
    icon: Heart,
  },
  card: {
    title: "Loading photo",
    subtitle: "Just a moment…",
    icon: Loader2,
  },
};

export function OnboardingLoadingPanel({
  variant,
  compact = false,
  className,
}: {
  variant: Variant;
  compact?: boolean;
  className?: string;
}) {
  const { title, subtitle, icon: Icon } = COPY[variant];
  const spinning = variant === "card";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8" : "min-h-0 flex-1 py-12",
        className,
      )}
    >
      <div className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-brand-tint">
        <Icon
          className={cn(
            "size-7 text-brand",
            spinning && "animate-spin",
            variant === "saving" && "animate-pulse",
          )}
          aria-hidden
        />
        {variant !== "card" ? (
          <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-brand">
            <Loader2 className="size-3 animate-spin text-white" aria-hidden />
          </span>
        ) : null}
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-ink-secondary">{subtitle}</p>
      {variant === "saving" ? (
        <div className="mt-6 flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 animate-pulse rounded-full bg-brand/60"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
