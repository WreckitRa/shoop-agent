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
    <p className="fitting-whisper mb-5 mt-3 max-w-[530px] font-[family-name:var(--font-fraunces)] text-[14px] italic leading-[1.4] text-[var(--fitting-quiet)] lg:mt-2.5 lg:text-[14.5px] lg:leading-[1.62] [&_b]:font-semibold [&_b]:not-italic [&_b]:text-[var(--fitting-ink)]">
      {children}
    </p>
  );
}

export function FittingKick({ children }: { children: React.ReactNode }) {
  return (
    <div className="fitting-kick mb-3.5 font-display text-[10px] font-extrabold tracking-[0.16em] text-[var(--fitting-red)] lg:mb-2.5 lg:text-[9.5px]">
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
    <h1 className="max-w-[640px] font-display text-[clamp(28px,8.4vw,38px)] font-black leading-[0.98] tracking-[-0.045em] text-[var(--fitting-ink)] lg:text-[clamp(22px,2.8vw,32px)] lg:leading-[1.05] lg:tracking-[-0.04em]">
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
    <div className="fitting-count mb-3.5 font-display text-[10px] font-black tracking-[0.16em] text-[var(--fitting-red)] lg:mb-3 lg:text-[9.5px] lg:tracking-[0.14em] lg:text-[var(--fitting-quiet)] lg:font-extrabold">
      {String(n).padStart(2, "0")}{" "}
      <span className="text-[var(--fitting-red)] lg:text-[#C4C4CC]">
        · OF {String(total).padStart(2, "0")}
      </span>
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
        "inline-flex h-[54px] w-full max-w-none items-center justify-center rounded-[16px] border-0 px-5 text-center font-display text-[14px] font-black transition-transform duration-150 hover:-translate-y-0.5 disabled:hover:translate-y-0 lg:h-[52px] lg:max-w-[400px] lg:rounded-[14px] lg:text-[14.5px] lg:font-extrabold",
        inverse
          ? "bg-white text-[var(--fitting-ink)] disabled:bg-white/20 disabled:text-white/40"
          : "bg-[var(--fitting-ink)] text-white shadow-[0_16px_32px_-18px_rgba(26,26,46,1)] disabled:bg-[var(--fitting-g3)] disabled:text-[#A8A8B0] disabled:shadow-none",
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
    <div className="fitting-nav max-lg:fixed max-lg:inset-x-[22px] max-lg:bottom-[calc(20px+env(safe-area-inset-bottom,0px))] max-lg:z-[8] max-lg:mt-0 max-lg:bg-transparent sticky bottom-0 z-[4] mt-8 -mx-1 flex flex-col items-stretch gap-3.5 bg-white pb-1 pt-5 lg:relative lg:inset-auto lg:flex-row lg:flex-wrap lg:items-center lg:gap-4 lg:bg-gradient-to-t lg:from-white lg:via-white/95 lg:to-transparent lg:pt-6">
      <FittingCta onClick={onNext} disabled={busy}>
        {busy ? "Saving…" : nextLabel}
      </FittingCta>
      {skip ? (
        <button
          type="button"
          onClick={skip.onClick}
          disabled={busy}
          className="self-center border-0 bg-transparent p-0 font-sans text-[12px] font-semibold text-[var(--fitting-quiet)] lg:self-auto lg:text-[12.5px] lg:underline lg:decoration-[#C4C4CC] lg:underline-offset-4 hover:text-[var(--fitting-ink)]"
        >
          {skip.label}
        </button>
      ) : null}
      {enterHint ? (
        <span className="hidden text-[11px] font-semibold tracking-[0.06em] text-[#C4C4CC] lg:inline">
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
      className="mt-6 w-full max-w-[440px] border-0 border-b-2 border-[var(--fitting-g3)] bg-transparent py-3.5 font-display text-[26px] font-black tracking-[-0.03em] text-[var(--fitting-ink)] outline-none placeholder:font-black placeholder:text-[#D9D9DE] focus:border-[var(--fitting-red)] lg:mt-0 lg:border-b-[2.5px] lg:border-[var(--fitting-ink)] lg:py-1.5 lg:text-[30px] lg:tracking-normal"
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

const CHIP_INSET =
  "shadow-[inset_0_3px_5px_-1px_rgba(14,14,17,0.18),inset_0_1px_2px_rgba(14,14,17,0.08)]";
const CHIP_INSET_ON =
  "shadow-[inset_0_3px_6px_-1px_rgba(14,14,17,0.28),inset_0_1px_2px_rgba(14,14,17,0.12)]";

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
  /** love = heart prefix, no = veto */
  variant?: "default" | "love" | "no" | "pressed";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "select-none rounded-[14px] border px-4 py-[13px] text-[14px] font-semibold tracking-[0.01em] transition-[box-shadow,border-color,background-color,color] duration-150 lg:rounded-xl lg:px-[15px] lg:py-2.5 lg:text-[13.5px]",
        !selected &&
          variant === "no" &&
          cn(
            CHIP_INSET,
            "border-[#eec9cb] bg-[#fffcfc] text-[#b3454c] lg:border-[#F0C9CC] lg:bg-white",
          ),
        !selected &&
          variant !== "no" &&
          cn(
            CHIP_INSET,
            "border-[var(--fitting-line)] bg-white text-[var(--fitting-ink)]",
          ),
        selected &&
          variant === "no" &&
          "border-[var(--fitting-red)] bg-[var(--fitting-red)] text-white shadow-[inset_0_3px_6px_-1px_rgba(80,10,14,0.35)]",
        selected &&
          variant !== "no" &&
          cn(
            CHIP_INSET_ON,
            "border-[var(--fitting-ink)] bg-[#F4F4F6] text-[var(--fitting-ink)]",
          ),
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
        "relative overflow-hidden rounded-2xl border p-[16px_15px] text-left transition-[box-shadow,border-color,background-color] duration-150",
        selected
          ? cn(
              CHIP_INSET_ON,
              "border-[var(--fitting-ink)] bg-[#F4F4F6] text-[var(--fitting-ink)]",
            )
          : cn(CHIP_INSET, "border-[var(--fitting-line)] bg-white"),
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
        className="mb-1 block font-display text-[14.5px] font-black tracking-[-0.02em] leading-[1.15]"
      >
        {title}
      </span>
      {hint ? (
        <span className="mt-1.5 block text-[11.5px] leading-[1.4] text-[var(--fitting-quiet)]">
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
