"use client";

import { cn } from "@/lib/ai-chat/cn";

export function OnboardingWhy({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 inline-block rounded-lg bg-[#FDF8F3] px-3 py-2 text-xs leading-5 text-[#B0836A]">
      {children}
    </p>
  );
}

/** Soft recessed chip/tile look — inset even before selection. */
const optionInset =
  "shadow-[inset_0_2px_5px_rgba(12,12,12,0.07),inset_0_-1px_0_rgba(255,255,255,0.85)]";

const optionSelected =
  "border-[#E8A09C] bg-[#FDF1F0] text-[#C43B35] shadow-[inset_0_2px_6px_rgba(196,59,53,0.12),inset_0_-1px_0_rgba(255,255,255,0.7)]";

const optionIdle =
  "border-neutral-200/80 bg-[#F5F3F0] text-ink hover:border-neutral-300 hover:bg-[#F1EFEC]";

export function OnboardingChip({
  selected,
  onClick,
  children,
  disabled,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-2 text-sm font-semibold transition",
        optionInset,
        selected ? optionSelected : optionIdle,
        disabled && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}

export function OnboardingTile({
  selected,
  onClick,
  title,
  hint,
}: {
  selected?: boolean;
  onClick?: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3.5 text-left transition",
        optionInset,
        selected ? optionSelected : optionIdle,
      )}
    >
      <span className="block text-[13.5px] font-bold">{title}</span>
      {hint ? (
        <span
          className={cn(
            "mt-0.5 block text-[11.5px] font-normal",
            selected ? "text-[#C45C56]" : "text-neutral-400",
          )}
        >
          {hint}
        </span>
      ) : null}
    </button>
  );
}

export function OnboardingQGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1">
      <h4 className="mb-2 mt-3 text-[13.5px] font-semibold text-ink">
        {title}
        {hint ? (
          <span className="ml-1.5 text-xs font-normal text-neutral-400">
            {hint}
          </span>
        ) : null}
      </h4>
      {children}
    </div>
  );
}
