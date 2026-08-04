"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Coins, Search } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { CURRENCY_OPTIONS } from "@/lib/onboarding/form-options";
import { displayCurrencyFromLocalization } from "@/lib/shopify/catalog-localization";
import type { CatalogLocalization } from "@/lib/shopify/catalog-localization";

type MenuLayout = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const MENU_Z = 170;
const BACKDROP_Z = 160;
const PREFERRED_MENU_HEIGHT = 220;
const MENU_MIN_WIDTH = 240;

function computeMenuLayout(anchor: HTMLElement): MenuLayout {
  const rect = anchor.getBoundingClientRect();
  const viewportPad = 8;
  const gap = 4;
  const width = Math.max(rect.width, MENU_MIN_WIDTH);

  let spaceBelow = window.innerHeight - rect.bottom - viewportPad;
  let spaceAbove = rect.top - viewportPad;
  let openAbove = spaceBelow < 120 && spaceAbove > spaceBelow;

  let maxHeight = Math.min(
    PREFERRED_MENU_HEIGHT,
    openAbove ? spaceAbove - gap : spaceBelow - gap,
  );
  maxHeight = Math.max(maxHeight, 120);

  if (!openAbove && maxHeight < 120 && spaceAbove > spaceBelow) {
    openAbove = true;
    maxHeight = Math.min(PREFERRED_MENU_HEIGHT, spaceAbove - gap);
    maxHeight = Math.max(maxHeight, 120);
  }

  const left = Math.min(
    Math.max(viewportPad, rect.left),
    window.innerWidth - width - viewportPad,
  );

  const top = openAbove
    ? Math.max(viewportPad, rect.top - maxHeight - gap)
    : rect.bottom + gap;

  return { top, left, width, maxHeight };
}

type CatalogCurrencyPickerProps = {
  localization: CatalogLocalization | null;
  loading?: boolean;
  saving?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: (currencyCode: string) => Promise<{ ok: boolean; error?: string }>;
};

export function CatalogCurrencyPicker({
  localization,
  loading,
  saving,
  disabled,
  disabledReason,
  onSelect,
}: CatalogCurrencyPickerProps) {
  const listId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuLayout, setMenuLayout] = useState<MenuLayout | null>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCode =
    localization?.currency ??
    displayCurrencyFromLocalization(localization) ??
    "";

  useEffect(() => setMounted(true), []);

  const updateMenuLayout = useCallback(() => {
    if (!anchorRef.current) return;
    setMenuLayout(computeMenuLayout(anchorRef.current));
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuLayout();
    const onScrollOrResize = () => updateMenuLayout();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updateMenuLayout]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return CURRENCY_OPTIONS.filter((currency) => {
      if (!search) return true;
      return (
        currency.value.toLowerCase().includes(search) ||
        currency.label.toLowerCase().includes(search)
      );
    });
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setError(null);
  }, []);

  const pick = useCallback(
    async (code: string) => {
      if (disabled || saving) return;
      setError(null);
      const result = await onSelect(code);
      if (result.ok) {
        close();
        return;
      }
      setError(result.error ?? "Could not save currency");
    },
    [close, disabled, onSelect, saving],
  );

  const menu =
    open && menuLayout && mounted
      ? createPortal(
          <>
            <button
              type="button"
              aria-label="Close currency picker"
              className="fixed inset-0 cursor-default bg-transparent"
              style={{ zIndex: BACKDROP_Z }}
              onClick={close}
              tabIndex={-1}
            />
            <div
              style={{
                position: "fixed",
                top: menuLayout.top,
                left: menuLayout.left,
                width: menuLayout.width,
                maxHeight: menuLayout.maxHeight,
                zIndex: MENU_Z,
              }}
              className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-card ring-1 ring-black/5"
            >
              <div className="relative shrink-0 border-b border-hairline px-2 py-2">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
                  aria-hidden
                />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search currencies"
                  className="w-full rounded-lg border border-hairline bg-white py-1.5 pl-8 pr-2 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-brand/40 focus:ring-2 focus:ring-brand/15"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") close();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (filtered[0]) void pick(filtered[0].value);
                    }
                  }}
                />
              </div>
              <ul
                id={listId}
                role="listbox"
                className="min-h-0 flex-1 overflow-y-auto p-1"
              >
                {filtered.length ? (
                  filtered.map((currency) => {
                    const active = currency.value === selectedCode;
                    return (
                      <li
                        key={currency.value}
                        role="option"
                        aria-selected={active}
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void pick(currency.value)}
                          disabled={saving}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-50",
                            active
                              ? "bg-brand/10 text-brand"
                              : "text-ink hover:bg-surface-subtle",
                          )}
                        >
                          <span className="font-medium">{currency.label}</span>
                          {active ? (
                            <Check className="size-3 text-brand" aria-hidden />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                ) : (
                  <li className="px-2.5 py-3 text-xs text-ink-muted">
                    No currency found.
                  </li>
                )}
              </ul>
              {error ? (
                <p className="shrink-0 border-t border-hairline px-3 py-2 text-[10px] font-medium text-warning-dark">
                  {error}
                </p>
              ) : null}
            </div>
          </>,
          document.body,
        )
      : null;

  const label = !loading && selectedCode ? selectedCode : null;

  return (
    <div
      className="inline-flex min-w-0 items-center gap-2"
      aria-label="Preferred currency for catalog prices"
    >
      {label ? (
        <span
          className="hidden truncate font-mono text-[11px] font-medium tracking-wide text-ink-secondary md:inline"
          title={`Prices shown in ${label}`}
        >
          {label}
          {saving ? "…" : null}
        </span>
      ) : null}

      <button
        ref={anchorRef}
        type="button"
        disabled={disabled || loading}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        title={
          disabled
            ? disabledReason
            : "Change preferred currency for search and ranking"
        }
        onClick={() => {
          if (disabled || loading) return;
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-hairline bg-white px-2.5 text-[11px] font-medium tracking-wide text-ink-secondary transition-colors",
          disabled
            ? "cursor-not-allowed opacity-55"
            : "hover:border-line-medium hover:bg-surface-tint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20",
        )}
      >
        <Coins className="size-3 shrink-0" aria-hidden strokeWidth={1.75} />
        <span>Currency</span>
        {!loading && !disabled ? (
          <ChevronDown
            className={cn(
              "size-3 shrink-0 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        ) : null}
      </button>

      {menu}
    </div>
  );
}
