"use client";

import { cn } from "@/lib/ai-chat/cn";

export function OnboardingWhy({ children }: { children: React.ReactNode }) {
  return (
    <p className="hintline mt-2.5 max-w-[530px] text-[11.5px] leading-[1.55] text-[var(--fitting-quiet)] [&_b]:font-semibold [&_b]:text-[var(--fitting-ink)]">
      {children}
    </p>
  );
}

export function FittingWhisper({ children }: { children: React.ReactNode }) {
  return (
    <p className="fitting-whisper mb-5 mt-2.5 max-w-[530px] text-[14.5px] leading-[1.62] text-[var(--fitting-quiet)] [&_b]:font-semibold [&_b]:text-[var(--fitting-ink)]">
      {children}
    </p>
  );
}

export function FittingKick({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 font-display text-[9.5px] font-extrabold tracking-[0.16em] text-[var(--fitting-red)]">
      {children}
    </div>
  );
}

export function FittingTitle({
  lines,
}: {
  lines: Array<{ text: string; red?: boolean; delay?: string }>;
}) {
  return (
    <h1 className="max-w-[640px] font-display text-[clamp(22px,2.8vw,32px)] font-black leading-[1.05] tracking-[-0.04em] text-[var(--fitting-ink)]">
      {lines.map((line, i) => (
        <span key={i} className="block">
          <span
            className="fitting-motion inline-block [animation:fitting-wipe_0.55s_cubic-bezier(.3,0,.2,1)_forwards] [clip-path:inset(0_100%_0_0)]"
            style={{ animationDelay: line.delay ?? (i === 0 ? "0.04s" : "0.12s") }}
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
    <div className="fitting-count mb-3 text-[9.5px] font-extrabold tracking-[0.14em] text-[var(--fitting-quiet)]">
      {n} <span className="text-[#C4C4CC]">OF {total}</span>
    </div>
  );
}

export function FittingBackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center gap-1.5 border-0 bg-transparent p-0 font-sans text-[12px] font-semibold text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]"
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
  inverse,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  inverse?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-[52px] w-full max-w-[400px] items-center justify-center rounded-[14px] border-0 px-5 text-center font-display text-[14.5px] font-extrabold transition-transform duration-150 hover:-translate-y-0.5 disabled:hover:translate-y-0",
        inverse
          ? "bg-white text-[var(--fitting-ink)] disabled:bg-white/20 disabled:text-white/40"
          : "bg-[var(--fitting-ink)] text-white disabled:bg-[var(--fitting-g3)] disabled:text-[#A8A8B0]",
      )}
    >
      {children}
    </button>
  );
}

export function FittingNavRow({
  onNext,
  nextLabel = "Continue",
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
    <div className="sticky bottom-0 z-[4] mt-8 -mx-1 flex flex-wrap items-center gap-4 bg-gradient-to-t from-white via-white/95 to-transparent pb-1 pt-6">
      <FittingCta onClick={onNext} disabled={busy}>
        {busy ? "Saving…" : nextLabel}
      </FittingCta>
      {skip ? (
        <button
          type="button"
          onClick={skip.onClick}
          disabled={busy}
          className="border-0 bg-transparent p-0 font-sans text-[12.5px] font-semibold text-[var(--fitting-quiet)] underline decoration-[#C4C4CC] underline-offset-4 hover:text-[var(--fitting-ink)]"
        >
          {skip.label}
        </button>
      ) : null}
      {enterHint ? (
        <span className="text-[11px] font-semibold tracking-[0.06em] text-[#C4C4CC]">
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
      className="w-full max-w-[440px] border-0 border-b-[2.5px] border-[var(--fitting-ink)] bg-transparent py-1.5 font-display text-[30px] font-black text-[var(--fitting-ink)] outline-none placeholder:font-black placeholder:text-[#D9D9DE] focus:border-[var(--fitting-red)]"
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
    <div className="mb-2.5 mt-7 text-[12.5px] font-extrabold tracking-[0.01em] text-[var(--fitting-ink)]">
      {children}
      {hint ? (
        <small className="ml-2 text-[11px] font-semibold tracking-[0.04em] text-[var(--fitting-quiet)]">
          {hint}
        </small>
      ) : null}
    </div>
  );
}

export function FittingMulti({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mt-3 inline-block rounded-full bg-[var(--fitting-g2)] px-2.5 py-1 font-display text-[9px] font-extrabold tracking-[0.12em] text-[var(--fitting-quiet)]">
      {children ?? "PICK AS MANY AS ARE TRUE"}
    </div>
  );
}

export function FittingPromise({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 max-w-[560px] rounded-r-[14px] border-l-[3px] border-[var(--fitting-red)] bg-[var(--fitting-g2)] px-[18px] py-4">
      <p className="text-[14px] leading-[1.66] text-[var(--fitting-ink)] [&_b]:font-semibold">
        {children}
      </p>
    </div>
  );
}

export function FittingCounted({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 max-w-[560px] rounded-[15px] bg-[var(--fitting-ink)] px-[18px] py-[15px] text-white">
      <b className="block font-display text-[17px] font-black">{title}</b>
      <span className="mt-1.5 block text-[13px] leading-[1.55] text-[#B4B4C0]">
        {children}
      </span>
    </div>
  );
}

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
        "select-none rounded-xl border-[1.5px] px-[15px] py-2.5 text-[13.5px] font-semibold tracking-[0.01em] transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-[var(--fitting-ink)]",
        !selected &&
          variant === "no" &&
          "border-[#F0C9CC] bg-white text-[#B3454C]",
        !selected &&
          variant !== "no" &&
          "border-[var(--fitting-line)] bg-white text-[var(--fitting-ink)]",
        selected &&
          variant === "no" &&
          "border-[var(--fitting-red)] bg-[var(--fitting-red)] text-white",
        selected &&
          variant !== "no" &&
          "border-[var(--fitting-ink)] bg-[var(--fitting-ink)] text-white",
        disabled && "opacity-50",
      )}
    >
      {selected && variant === "love" ? (
        <span className="text-[#FF8A90]">♥ </span>
      ) : null}
      {selected && variant === "no" ? <span>✕ </span> : null}
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
        "relative overflow-hidden rounded-2xl border-2 border-[var(--fitting-line)] bg-white p-[16px_15px] text-left transition-all duration-150",
        "hover:-translate-y-[3px] hover:shadow-[0_16px_30px_-20px_rgba(26,26,46,0.4)]",
        selected && "border-[var(--fitting-ink)] bg-[var(--fitting-ink)] text-white",
      )}
    >
      <span
        className={cn(
          "absolute right-2.5 top-2.5 hidden size-[19px] place-items-center rounded-full bg-white font-display text-[9px] font-extrabold text-[var(--fitting-ink)]",
          selected && "grid",
        )}
      >
        ✓
      </span>
      <span
        className={cn(
          "mb-1 block font-display text-[14.5px] font-black tracking-[-0.02em] leading-[1.15]",
          selected && "text-white",
        )}
      >
        {title}
      </span>
      {hint ? (
        <span
          className={cn(
            "mt-1.5 block text-[11.5px] leading-[1.4] text-[var(--fitting-quiet)]",
            selected && "text-white/70",
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
      <FittingQlbl hint={hint}>{title}</FittingQlbl>
      {children}
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
        "w-[160px] rounded-xl border-[1.5px] border-dashed border-[var(--fitting-g3)] bg-transparent px-[15px] py-2.5 text-[13.5px] font-semibold text-[var(--fitting-ink)] outline-none transition-all placeholder:font-semibold placeholder:text-[var(--fitting-quiet)] focus:w-[200px] focus:border-solid focus:border-[var(--fitting-ink)]",
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
