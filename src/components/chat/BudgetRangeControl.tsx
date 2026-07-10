"use client";

import { useCallback } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { formatBudgetAmount } from "@/lib/ai-chat/search-clarification";
import type { ClarificationQuestion } from "@/lib/ai-chat/types";

export type BudgetRangeValue = {
  min: number;
  max: number;
  currency: string;
  /** Strict ("hard") vs flexible ("soft") budget. Defaults to soft. */
  budgetType?: "hard" | "soft";
};

type BudgetBounds = { floor: number; ceiling: number };

function snap(value: number, floor: number, ceiling: number, step: number): number {
  const clamped = Math.min(ceiling, Math.max(floor, value));
  const snapped = floor + Math.round((clamped - floor) / step) * step;
  return Math.min(ceiling, Math.max(floor, snapped));
}

function isAtFloor(value: number, floor: number): boolean {
  return value <= floor;
}

function isAtCeiling(value: number, ceiling: number): boolean {
  return value >= ceiling;
}

/** Both ends open — buyer has no budget constraint in mind. */
export function isNoBudgetInMind(
  value: BudgetRangeValue,
  bounds: BudgetBounds,
): boolean {
  return (
    isAtFloor(value.min, bounds.floor) && isAtCeiling(value.max, bounds.ceiling)
  );
}

export function noBudgetInMindValue(
  question: ClarificationQuestion,
): BudgetRangeValue {
  const slider = question.budgetSlider!;
  return {
    min: 0,
    max: slider.ceiling,
    currency: slider.currency,
  };
}

export function initialBudgetRangeValue(
  question: ClarificationQuestion,
): BudgetRangeValue {
  const slider = question.budgetSlider!;
  const floor = 0;
  const { ceiling, defaultMode, defaultMin, defaultMax, currency } = slider;

  switch (defaultMode) {
    case "any":
      return { min: floor, max: ceiling, currency };
    case "at_least":
      return { min: defaultMin, max: ceiling, currency };
    case "range":
      return { min: defaultMin, max: defaultMax, currency };
    case "up_to":
    default:
      return { min: floor, max: defaultMax, currency };
  }
}

export function budgetRangeToAnswer(
  value: BudgetRangeValue,
  bounds: BudgetBounds,
) {
  const { min, max, currency } = value;
  const { floor, ceiling } = bounds;
  const minOpen = isAtFloor(min, floor);
  const maxOpen = isAtCeiling(max, ceiling);
  // Strictness only matters when there's an upper bound to honor.
  const budgetType: "hard" | "soft" | undefined = maxOpen
    ? undefined
    : (value.budgetType ?? "soft");

  if (minOpen && maxOpen) {
    return { budgetMin: null, budgetMax: null, currency };
  }
  if (minOpen) {
    return { budgetMin: null, budgetMax: max, currency, budgetType };
  }
  if (maxOpen) {
    return { budgetMin: min, budgetMax: null, currency };
  }
  return { budgetMin: min, budgetMax: max, currency, budgetType };
}

export function budgetRangeSummary(
  value: BudgetRangeValue,
  bounds: BudgetBounds,
): string {
  const { currency, min, max } = value;
  const { floor, ceiling } = bounds;
  const minOpen = isAtFloor(min, floor);
  const maxOpen = isAtCeiling(max, ceiling);

  if (minOpen && maxOpen) return "No budget in mind";
  if (minOpen) {
    return `Up to ${formatBudgetAmount(max, currency)}`;
  }
  if (maxOpen) {
    return `${formatBudgetAmount(min, currency)}+`;
  }
  return `${formatBudgetAmount(min, currency)} – ${formatBudgetAmount(max, currency)}`;
}

const THUMB_SIZE = 22;

const RANGE_INPUT_CLASS = cn(
  "pointer-events-none absolute inset-x-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent",
  "h-[22px] disabled:cursor-not-allowed disabled:opacity-40",
  "[&::-webkit-slider-runnable-track]:h-[5px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-[22px]",
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:border-[0.5px] [&::-webkit-slider-thumb]:border-black/10",
  "[&::-webkit-slider-thumb]:bg-white",
  "[&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]",
  "[&::-webkit-slider-thumb]:mt-[calc((5px-22px)/2)]",
  "[&::-moz-range-track]:h-[5px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-[22px]",
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[0.5px]",
  "[&::-moz-range-thumb]:border-black/10 [&::-moz-range-thumb]:bg-white",
  "[&::-moz-range-thumb]:shadow-[0_2px_8px_rgba(0,0,0,0.12)]",
);

function DualRangeSlider({
  min,
  max,
  floor,
  ceiling,
  step,
  currency,
  disabled,
  onChange,
}: {
  min: number;
  max: number;
  floor: number;
  ceiling: number;
  step: number;
  currency: string;
  disabled?: boolean;
  onChange: (next: { min: number; max: number }) => void;
}) {
  const span = ceiling - floor;
  const minPct = span > 0 ? ((min - floor) / span) * 100 : 0;
  const maxPct = span > 0 ? ((max - floor) / span) * 100 : 100;
  const minOnTop = min > (max + floor) / 2;
  const rangeLeft = `calc(${THUMB_SIZE / 2}px + (100% - ${THUMB_SIZE}px) * ${minPct / 100})`;
  const rangeWidth = `calc((100% - ${THUMB_SIZE}px) * ${(maxPct - minPct) / 100})`;

  const maxLabel = isAtCeiling(max, ceiling)
    ? `${formatBudgetAmount(max, currency)}+`
    : formatBudgetAmount(max, currency);

  const handleMin = useCallback(
    (raw: number) => {
      const nextMin = snap(raw, floor, ceiling, step);
      onChange({ min: Math.min(nextMin, max), max });
    },
    [ceiling, floor, max, onChange, step],
  );

  const handleMax = useCallback(
    (raw: number) => {
      const nextMax = snap(raw, floor, ceiling, step);
      onChange({ min, max: Math.max(nextMax, min) });
    },
    [ceiling, floor, min, onChange, step],
  );

  return (
    <div className="relative h-[22px]">
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-black/[0.06]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-ink/80 transition-[left,width] duration-150 ease-out"
        style={{ left: rangeLeft, width: rangeWidth }}
        aria-hidden
      />
      <input
        type="range"
        min={floor}
        max={ceiling}
        step={step}
        disabled={disabled}
        value={min}
        aria-label={`Minimum budget ${formatBudgetAmount(min, currency)}`}
        onChange={(e) => handleMin(Number(e.target.value))}
        className={cn(RANGE_INPUT_CLASS, "cursor-pointer", minOnTop ? "z-[2]" : "z-[1]")}
        style={{ WebkitAppearance: "none" }}
      />
      <input
        type="range"
        min={floor}
        max={ceiling}
        step={step}
        disabled={disabled}
        value={max}
        aria-label={`Maximum budget ${maxLabel}`}
        onChange={(e) => handleMax(Number(e.target.value))}
        className={cn(RANGE_INPUT_CLASS, "cursor-pointer", minOnTop ? "z-[1]" : "z-[2]")}
        style={{ WebkitAppearance: "none" }}
      />
    </div>
  );
}

export function BudgetRangeControl({
  question,
  value,
  disabled,
  onChange,
}: {
  question: ClarificationQuestion;
  value: BudgetRangeValue;
  disabled?: boolean;
  onChange: (value: BudgetRangeValue) => void;
}) {
  const slider = question.budgetSlider!;
  const { ceiling, step } = slider;
  const floor = 0;
  const bounds = { floor, ceiling };
  const noBudget = isNoBudgetInMind(value, bounds);

  const setRange = useCallback(
    (next: { min: number; max: number }) => {
      onChange({ ...value, min: next.min, max: next.max });
    },
    [onChange, value],
  );

  const selectNoBudget = useCallback(() => {
    onChange(noBudgetInMindValue(question));
  }, [onChange, question]);

  const hasCeilingBound = !isAtCeiling(value.max, ceiling);
  const budgetType = value.budgetType ?? "soft";
  const setBudgetType = useCallback(
    (next: "hard" | "soft") => {
      onChange({ ...value, budgetType: next });
    },
    [onChange, value],
  );

  const minLabel = formatBudgetAmount(value.min, value.currency);
  const maxLabel = isAtCeiling(value.max, ceiling)
    ? `${formatBudgetAmount(value.max, value.currency)}+`
    : formatBudgetAmount(value.max, value.currency);

  return (
    <div className="space-y-3">
      <div className="shoop-quiz-chips">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={noBudget}
          onClick={selectNoBudget}
          className={
            noBudget ? "shoop-quiz-chip shoop-quiz-chip--active" : "shoop-quiz-chip"
          }
        >
          No budget in mind
        </button>
      </div>

      {noBudget ? (
        <div className="rounded-[18px] border border-dashed border-hairline bg-surface-tint px-4 py-3.5 text-sm leading-snug text-ink-secondary">
          <p className="font-medium text-ink">Open to any price</p>
          <p className="mt-1 text-xs text-ink-muted">
            Shoop will prioritize fit and quality over hitting a price target.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(initialBudgetRangeValue(question))}
            className="mt-2.5 text-xs font-medium text-ink underline-offset-2 hover:underline disabled:opacity-40"
          >
            Set a budget instead
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-black/[0.06] bg-white px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)] sm:px-5">
          <div className="space-y-3">
            <DualRangeSlider
              min={value.min}
              max={value.max}
              floor={floor}
              ceiling={ceiling}
              step={step}
              currency={value.currency}
              disabled={disabled}
              onChange={setRange}
            />
            <div className="flex justify-between text-[13px] font-semibold tabular-nums tracking-tight text-ink">
              <span>{minLabel}</span>
              <span>{maxLabel}</span>
            </div>
            {hasCeilingBound ? (
              <div className="flex items-center gap-1.5 pt-0.5">
                <BudgetTypeToggle
                  active={budgetType === "soft"}
                  disabled={disabled}
                  label="Flexible"
                  hint="A little over is OK if it's worth it"
                  onClick={() => setBudgetType("soft")}
                />
                <BudgetTypeToggle
                  active={budgetType === "hard"}
                  disabled={disabled}
                  label="Hardcap"
                  hint="Never go over"
                  onClick={() => setBudgetType("hard")}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function BudgetTypeToggle({
  active,
  disabled,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={cn(
        "flex-1 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-ink text-white"
          : "bg-black/[0.04] text-ink-secondary hover:bg-black/[0.07]",
      )}
    >
      {label}
    </button>
  );
}
