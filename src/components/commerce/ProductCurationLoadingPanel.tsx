"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export function ProductCurationLoadingPanel({
  className,
  variant = "inline",
}: {
  className?: string;
  variant?: "inline" | "sidebar" | "banner";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-hairline-soft bg-surface-tint/60 px-4 py-4",
        variant === "sidebar" && "border-brand/15 bg-brand/[0.03]",
        className,
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-ink-secondary">
        <Loader2 className="size-4 shrink-0 animate-spin text-brand" aria-hidden />
        Personalizing for you…
      </div>
      <div className="flex flex-col gap-2 animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-[80%] max-w-xs rounded bg-slate-200/80" />
        <div className="h-3 w-full rounded bg-slate-200/60" />
        <div className="h-3 w-[92%] rounded bg-slate-200/50" />
      </div>
    </div>
  );
}
