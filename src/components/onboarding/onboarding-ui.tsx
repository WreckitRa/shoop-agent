"use client";

import { cn } from "@/lib/ai-chat/cn";

export function OnboardingWhy({ children }: { children: React.ReactNode }) {
  return (
    <p className="hintline mt-3 max-w-[480px] text-[11.5px] leading-[1.6] text-[var(--fitting-quiet)]">
      {children}
    </p>
  );
}

export function FittingWhisper({ children }: { children: React.ReactNode }) {
  return (
    <p className="fitting-whisper mb-[34px] mt-4 max-w-[520px] font-whisper text-[17px] italic leading-[1.55] text-[var(--fitting-quiet)] [&_b]:font-medium [&_b]:not-italic [&_b]:text-[var(--fitting-ink)]">
      {children}
    </p>
  );
}

export function FittingTitle({
  lines,
}: {
  lines: Array<{ text: string; red?: boolean; delay?: string }>;
}) {
  return (
    <h1 className="max-w-[640px] font-display text-[clamp(32px,4.6vw,56px)] font-extrabold leading-[1.04] tracking-[-0.025em] text-[var(--fitting-ink)]">
      {lines.map((line, i) => (
        <span key={i} className="block">
          <span
            className="fitting-motion inline-block [animation:fitting-wipe_0.7s_cubic-bezier(.7,0,.2,1)_forwards] [clip-path:inset(0_100%_0_0)]"
            style={{ animationDelay: line.delay ?? (i === 0 ? "0.1s" : "0.25s") }}
          >
            {line.red ? (
              <>
                {line.text.split("%%").map((part, j) =>
                  j % 2 === 1 ? (
                    <span key={j} className="text-[var(--fitting-red)]">
                      {part}
                    </span>
                  ) : (
                    <span key={j}>{part}</span>
                  ),
                )}
              </>
            ) : (
              line.text
            )}
          </span>
        </span>
      ))}
    </h1>
  );
}

export function FittingCount({
  n,
  total,
}: {
  n: number;
  total: number;
}) {
  return (
    <div className="fitting-count mb-[18px] text-xs font-extrabold tracking-[0.08em] text-[var(--fitting-red)]">
      {n} <span className="text-[#C9C9CF]">of {total}</span>
    </div>
  );
}

export function FittingBackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3.5 inline-flex items-center gap-1.5 border-0 bg-transparent p-0 font-sans text-[12.5px] font-bold text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]"
    >
      ← back
    </button>
  );
}

export function FittingCta({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex h-14 items-center gap-3 rounded-[14px] border-0 bg-[var(--fitting-ink)] px-[30px] font-display text-[14.5px] font-extrabold tracking-[0.01em] text-white transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_14px_26px_-10px_rgba(228,40,49,0.6)] disabled:opacity-50"
    >
      {children}
      <span className="transition-transform group-hover:translate-x-1">→</span>
    </button>
  );
}

export function FittingNavRow({
  onNext,
  nextLabel = "Lock it in",
  busy,
  enterHint = true,
  skip,
}: {
  onNext: () => void;
  nextLabel?: string;
  busy?: boolean;
  enterHint?: boolean;
  skip?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-5">
      <FittingCta onClick={onNext} disabled={busy}>
        {busy ? "Saving…" : nextLabel}
      </FittingCta>
      {skip ? (
        <button
          type="button"
          onClick={skip.onClick}
          disabled={busy}
          className="border-0 border-b border-[var(--fitting-line)] bg-transparent pb-0.5 font-sans text-[12.5px] font-semibold text-[var(--fitting-quiet)]"
        >
          {skip.label}
        </button>
      ) : null}
      {enterHint ? (
        <span className="text-[11px] font-semibold tracking-[0.06em] text-[#C9C9CF]">
          or press enter
        </span>
      ) : null}
    </div>
  );
}

export function FittingField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete="given-name"
      className="w-full max-w-[440px] border-0 border-b-[3px] border-[var(--fitting-ink)] bg-transparent py-1.5 font-display text-[34px] font-bold text-[var(--fitting-ink)] outline-none placeholder:font-bold placeholder:text-[#D9D9DE] focus:border-[var(--fitting-red)]"
    />
  );
}

export function FittingQlbl({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 mt-[30px] text-[12.5px] font-extrabold tracking-[0.01em] text-[var(--fitting-ink)]">
      {children}
      {hint ? (
        <small className="ml-2 text-[11px] font-semibold tracking-[0.05em] text-[var(--fitting-quiet)]">
          {hint}
        </small>
      ) : null}
    </div>
  );
}

/** Soft recessed chip/tile look — legacy alias used by non-fitting surfaces. */
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
  variant = "default",
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** love = heart prefix, no = veto, pressed = soft inset */
  variant?: "default" | "love" | "no" | "pressed";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "select-none rounded-xl border px-[18px] py-[11px] text-[13px] font-bold tracking-[0.01em] transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-[var(--fitting-ink)] hover:shadow-[0_6px_14px_-8px_rgba(14,14,17,0.3)]",
        !selected &&
          variant === "no" &&
          "border-[#F0C9CC] bg-[#FFFCFC] text-[#B3454C]",
        !selected &&
          variant !== "no" &&
          "border-[#D6D6DE] bg-white text-[var(--fitting-ink)]",
        selected &&
          variant === "love" &&
          "border-[var(--fitting-ink)] bg-[var(--fitting-ink)] text-white",
        selected &&
          variant === "no" &&
          "border-[var(--fitting-red)] bg-[#FDECEC] text-[var(--fitting-red)] line-through decoration-[1.5px]",
        selected &&
          (variant === "default" || variant === "pressed") &&
          "border-[#B9B9C2] bg-[#E9E9EE] text-[var(--fitting-ink)] shadow-[inset_0_3px_3px_-1px_rgba(14,14,17,0.4),inset_0_0_0_1px_rgba(14,14,17,0.06)]",
        disabled && "opacity-50",
      )}
    >
      {selected && variant === "love" ? (
        <span className="text-[#FF8A90]">♥ </span>
      ) : null}
      {selected && variant === "no" ? (
        <span className="no-underline">✕ </span>
      ) : null}
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
        "rounded-xl border border-[#D6D6DE] bg-white p-[18px_16px] text-left transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-12px_rgba(14,14,17,0.35)]",
        selected &&
          "border-[var(--fitting-red)] bg-[var(--fitting-mist)] shadow-[inset_0_3px_4px_-1px_rgba(14,14,17,0.22)]",
      )}
    >
      <span
        className={cn(
          "mb-2 block font-display text-[15px] font-extrabold",
          selected && "text-[var(--fitting-red)]",
        )}
      >
        {title}
      </span>
      {hint ? (
        <span className="block font-whisper text-[12.5px] italic leading-[1.55] text-[var(--fitting-quiet)]">
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
      <FittingQlbl hint={hint}>{title}</FittingQlbl>
      {children}
    </div>
  );
}

/** Legacy exports used by ProfileView-style pages */
export function LegacyOnboardingChip({
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

export function FittingAddIn({
  placeholder,
  onSubmit,
  danger,
}: {
  placeholder: string;
  onSubmit: (value: string) => void;
  danger?: boolean;
}) {
  return (
    <input
      className={cn(
        "w-[150px] rounded-xl border-[1.5px] border-dashed border-[#D6D6DE] bg-transparent px-4 py-[11px] text-[13px] font-semibold text-[var(--fitting-ink)] outline-none transition-all placeholder:font-semibold placeholder:text-[#B7B7BF] focus:w-[190px] focus:border-solid focus:border-[var(--fitting-ink)]",
        danger && "border-[#F0C9CC]",
      )}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const el = e.currentTarget;
        const v = el.value.trim();
        if (!v) return;
        onSubmit(v);
        el.value = "";
      }}
    />
  );
}
