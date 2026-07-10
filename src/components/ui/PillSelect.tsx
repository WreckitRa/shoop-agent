"use client";

import { cn } from "@/lib/ai-chat/cn";

export type PillOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly PillOption[];
  optional?: boolean;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
};

export function PillSelect({
  label,
  value,
  onChange,
  options,
  optional = false,
  columns = 3,
  className,
}: Props) {
  const colClass =
    columns === 2
      ? "grid-cols-2"
      : columns === 4
        ? "grid-cols-2 sm:grid-cols-4"
        : columns === 5
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          : "grid-cols-2 sm:grid-cols-3";

  const hasCustom =
    value && !options.some((o) => o.value === value);

  return (
    <div className={cn("space-y-2", className)}>
      <span className="block text-sm font-medium text-ink">
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-ink-muted">Optional</span>
        ) : null}
      </span>
      <div
        className={cn("grid gap-2", colClass)}
        role="radiogroup"
        aria-label={label}
      >
        {hasCustom ? (
          <button
            type="button"
            role="radio"
            aria-checked
            className="rounded-xl border border-brand bg-brand-tint px-3 py-2.5 text-left text-sm font-medium text-brand-dark ring-1 ring-brand/20"
          >
            {value}
          </button>
        ) : null}
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-all duration-150 ease-ios active:scale-[0.98]",
                active
                  ? "border-brand bg-brand-tint font-medium text-brand-dark ring-1 ring-brand/20"
                  : "border-hairline bg-white text-ink hover:border-brand/30 hover:bg-surface-tint/60",
              )}
            >
              <span className="block text-sm">{option.label}</span>
              {option.hint ? (
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                  {option.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
