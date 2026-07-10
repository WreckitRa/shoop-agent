"use client";

import { Lock, Sparkles, UserPlus } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { openAuthModal } from "@/hooks/useGuestMode";

const PREVIEW_LINES = [
  "Matched to your size, budget, and style from past shoops",
  "Buy / wait / pass verdict with reasons you can trust",
  "What Shoop checked — price, fit signals, returns, and more",
];

function PreviewSkeleton({ dense }: { dense?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none select-none overflow-hidden rounded-xl border border-hairline/80 bg-gradient-to-br from-surface-subtle to-white",
        dense ? "p-3" : "p-4",
      )}
    >
      <div className="space-y-2 blur-[3px]">
        <div className="h-2.5 w-3/4 rounded bg-ink/10" />
        <div className="h-2 w-full rounded bg-ink/8" />
        <div className="h-2 w-5/6 rounded bg-ink/8" />
        {!dense ? (
          <>
            <div className="mt-3 h-16 rounded-lg bg-brand/10" />
            <div className="h-2 w-2/3 rounded bg-ink/8" />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function LockedPersonalizationPanel({
  variant = "full",
  className,
}: {
  variant?: "full" | "sidebar" | "banner";
  className?: string;
}) {
  const dense = variant === "sidebar" || variant === "banner";

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.06] via-white to-info-bg/40",
        dense ? "p-4" : "p-5 md:p-6",
        className,
      )}
      aria-label="Personalized insights — sign up to unlock"
    >
      <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-brand/10 blur-2xl" />

      <div className="relative flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-brand/15">
            <Sparkles className="size-5 text-brand" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className={cn(
                  "font-bold tracking-tight text-ink",
                  dense ? "text-sm" : "text-base",
                )}
              >
                Personalized for you — locked
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand ring-1 ring-brand/20">
                <Lock className="size-3" aria-hidden />
                Members
              </span>
            </div>
            <p
              className={cn(
                "mt-1 leading-snug text-ink-secondary",
                dense ? "text-xs" : "text-sm",
              )}
            >
              Shoop curates every pick with fit reasons, a clear verdict, and
              what would change our mind — synced when you create a free account.
            </p>
          </div>
        </div>

        <PreviewSkeleton dense={dense} />

        {!dense ? (
          <ul className="grid gap-2 sm:grid-cols-3">
            {PREVIEW_LINES.map((line) => (
              <li
                key={line}
                className="flex gap-2 rounded-xl border border-white/80 bg-white/70 px-3 py-2.5 text-xs leading-snug text-ink-secondary"
              >
                <Sparkles
                  className="mt-0.5 size-3.5 shrink-0 text-brand"
                  aria-hidden
                />
                {line}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => openAuthModal("signup")}
            className="btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold"
          >
            <UserPlus className="size-4" aria-hidden />
            Create free account
          </button>
          <button
            type="button"
            onClick={() => openAuthModal("login")}
            className="w-full py-1 text-center text-xs text-ink-muted transition hover:text-brand"
          >
            Already have an account?{" "}
            <span className="font-medium text-brand">Sign in</span>
          </button>
        </div>
      </div>
    </section>
  );
}
