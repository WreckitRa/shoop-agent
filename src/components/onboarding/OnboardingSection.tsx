"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  optional?: boolean;
  defaultOpen?: boolean;
  filled?: boolean;
  children: ReactNode;
};

export function OnboardingSection({
  icon,
  title,
  subtitle,
  optional = false,
  defaultOpen = true,
  filled = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-hairline bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-tint/40 sm:px-5"
        aria-expanded={open}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
            {optional ? (
              <span className="rounded-full bg-surface-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Optional
              </span>
            ) : (
              <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-dark">
                Required
              </span>
            )}
            {filled ? (
              <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-semibold text-success-dark">
                Done
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-ink-secondary">{subtitle}</p>
        </div>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-ink-muted transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="space-y-4 border-t border-hairline/80 px-4 pb-5 pt-4 sm:px-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
