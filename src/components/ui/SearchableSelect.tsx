"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type MenuLayout = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  allowCustom?: boolean;
  optional?: boolean;
  className?: string;
};

const MENU_Z = 160;
const BACKDROP_Z = 150;
const PREFERRED_MENU_HEIGHT = 208;

function computeMenuLayout(anchor: HTMLElement): MenuLayout {
  const rect = anchor.getBoundingClientRect();
  const viewportPad = 8;
  const gap = 4;

  let spaceBelow = window.innerHeight - rect.bottom - viewportPad;
  let spaceAbove = rect.top - viewportPad;
  let openAbove = spaceBelow < 140 && spaceAbove > spaceBelow;

  let maxHeight = Math.min(
    PREFERRED_MENU_HEIGHT,
    openAbove ? spaceAbove - gap : spaceBelow - gap,
  );
  maxHeight = Math.max(maxHeight, 96);

  if (!openAbove && maxHeight < 120 && spaceAbove > spaceBelow) {
    openAbove = true;
    maxHeight = Math.min(PREFERRED_MENU_HEIGHT, spaceAbove - gap);
    maxHeight = Math.max(maxHeight, 96);
  }

  const top = openAbove
    ? Math.max(viewportPad, rect.top - maxHeight - gap)
    : rect.bottom + gap;

  return {
    top,
    left: rect.left,
    width: rect.width,
    maxHeight,
  };
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  allowCustom = false,
  optional = false,
  className,
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuLayout, setMenuLayout] = useState<MenuLayout | null>(null);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value || o.label === value),
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          o.hint?.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [options, query]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateMenuLayout = useCallback(() => {
    if (!anchorRef.current) return;
    setMenuLayout(computeMenuLayout(anchorRef.current));
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuLayout(null);
      return;
    }

    updateMenuLayout();
    requestAnimationFrame(() => inputRef.current?.focus());

    const onScrollOrResize = () => updateMenuLayout();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updateMenuLayout]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(option: SelectOption) {
    onChange(option.value);
    close();
  }

  function commitCustom() {
    const custom = query.trim();
    if (allowCustom && custom) {
      onChange(custom);
      close();
    }
  }

  const displayValue = open ? query : selected?.label || value;

  const menu =
    open && menuLayout && mounted
      ? createPortal(
          <>
            <button
              type="button"
              aria-label="Close options"
              className="fixed inset-0 cursor-default bg-transparent"
              style={{ zIndex: BACKDROP_Z }}
              onClick={close}
              tabIndex={-1}
            />
            <ul
              id={listId}
              role="listbox"
              style={{
                position: "fixed",
                top: menuLayout.top,
                left: menuLayout.left,
                width: menuLayout.width,
                maxHeight: menuLayout.maxHeight,
                zIndex: MENU_Z,
              }}
              className="overflow-y-auto rounded-2xl border border-hairline bg-white p-1 shadow-card"
            >
              {filtered.length ? (
                filtered.map((option) => {
                  const active = option.value === value || option.label === value;
                  return (
                    <li
                      key={`${option.value}-${option.hint ?? ""}`}
                      role="option"
                      aria-selected={active}
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(option)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-surface-tint text-ink"
                            : "text-ink hover:bg-surface-tint",
                        )}
                      >
                        <span>{option.label}</span>
                        <span className="flex items-center gap-2">
                          {option.hint ? (
                            <span className="font-mono text-[10px] text-ink-muted">
                              {option.hint}
                            </span>
                          ) : null}
                          {active ? <Check className="size-3.5 text-ink" aria-hidden /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })
              ) : allowCustom && query.trim() ? (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={commitCustom}
                    className="flex w-full rounded-[10px] px-3 py-2 text-left text-sm text-ink hover:bg-surface-tint"
                  >
                    Use &ldquo;{query.trim()}&rdquo;
                  </button>
                </li>
              ) : (
                <li className="px-3 py-2 text-sm text-ink-muted">No matches found.</li>
              )}
            </ul>
          </>,
          document.body,
        )
      : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <span className="block text-sm font-medium text-ink">
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-ink-muted">Optional</span>
        ) : null}
      </span>

      <div ref={anchorRef} className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          value={displayValue}
          placeholder={open ? searchPlaceholder : value ? undefined : placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery(selected?.label || value);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[0]) pick(filtered[0]);
              else commitCustom();
            }
          }}
          className="input w-full rounded-xl border-hairline bg-white py-2.5 pl-9 pr-9 text-sm placeholder:text-ink-muted"
        />
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </div>

      {menu}
    </div>
  );
}
