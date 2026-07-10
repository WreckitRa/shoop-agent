"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import {
  DEFAULT_SHOPPING_FEELING,
  SHOPPING_FEELING_OPTIONS,
  type ShoppingFeelingId,
} from "@/lib/ai-chat/shopping-mood-feeling";

export function FeelingMoodPicker() {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ShoppingFeelingId>(
    DEFAULT_SHOPPING_FEELING,
  );

  const active = SHOPPING_FEELING_OPTIONS.find((o) => o.id === selected)!;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const select = (id: ShoppingFeelingId) => {
    const option = SHOPPING_FEELING_OPTIONS.find((o) => o.id === id);
    if (!option?.enabled) return;
    setSelected(id);
    close();
  };

  return (
    <div
      ref={rootRef}
      className="relative inline-flex min-w-0 shrink items-center gap-1.5 sm:gap-2"
    >
      <span className="hidden whitespace-nowrap text-[13px] font-normal text-ink-secondary sm:inline">
        I&apos;m feeling
      </span>

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-surface-tint px-2.5 py-1.5 text-[13px] font-semibold leading-[1.2] text-ink transition hover:bg-surface-subtle"
      >
        <span className="text-[15px] leading-none" aria-hidden>
          {active.emoji}
        </span>
        <span className="truncate">{active.label}</span>
        <ChevronDown
          className={cn(
            "ml-0.5 size-3.5 shrink-0 text-ink-muted transition-transform duration-[180ms]",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Shopping mood"
          className="shoop-mood-panel absolute bottom-[calc(100%+8px)] right-0 z-[60] max-h-[min(360px,calc(100vh-32px))] min-w-[280px] overflow-y-auto rounded-2xl border border-hairline bg-white p-1.5"
        >
          {SHOPPING_FEELING_OPTIONS.map((option) => {
            const isSelected = option.id === selected;
            const isEnabled = option.enabled;

            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={!isEnabled}
                disabled={!isEnabled}
                onClick={() => select(option.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border-0 px-2.5 py-2 text-left transition-[background] duration-[120ms]",
                  isSelected && isEnabled
                    ? "bg-surface-tint"
                    : "bg-transparent",
                  isEnabled
                    ? "cursor-pointer hover:bg-surface-tint/70"
                    : "cursor-not-allowed opacity-70",
                )}
              >
                <span
                  className="shrink-0 text-lg leading-none"
                  aria-hidden
                >
                  {option.emoji}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-[13px] font-semibold leading-[1.2] text-ink">
                    {option.label}
                  </span>
                  <span className="text-[11px] leading-[1.3] text-ink-secondary">
                    {option.hint}
                  </span>
                </span>
                {!isEnabled ? (
                  <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
                    Soon
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
