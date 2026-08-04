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
import { Check, ChevronDown, MapPin, Search } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { SHOPIFY_COUNTRIES } from "@/lib/cart/countries";
import type { CatalogLocalization } from "@/lib/shopify/catalog-localization";

type MenuLayout = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const MENU_Z = 170;
const BACKDROP_Z = 160;
const PREFERRED_MENU_HEIGHT = 240;
const MENU_MIN_WIDTH = 260;

function computeMenuLayout(anchor: HTMLElement): MenuLayout {
  const rect = anchor.getBoundingClientRect();
  const viewportPad = 8;
  const gap = 4;
  const width = Math.max(rect.width, MENU_MIN_WIDTH);

  const spaceBelow = window.innerHeight - rect.bottom - viewportPad;
  const spaceAbove = rect.top - viewportPad;
  let openAbove = spaceBelow < 140 && spaceAbove > spaceBelow;

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

type CatalogCountryPickerProps = {
  localization: CatalogLocalization | null;
  areaLabel?: string | null;
  loading?: boolean;
  saving?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: (countryCode: string) => Promise<{ ok: boolean; error?: string }>;
};

/**
 * Minimal country control: human-readable label + compact "Choose area" button.
 */
export function CatalogCountryPicker({
  localization,
  areaLabel,
  loading,
  saving,
  disabled,
  disabledReason,
  onSelect,
}: CatalogCountryPickerProps) {
  const listId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuLayout, setMenuLayout] = useState<MenuLayout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCode = localization?.countryCode ?? "";
  const selectedLabel =
    localization?.countryLabel ?? localization?.profileRaw ?? null;

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
    return SHOPIFY_COUNTRIES.filter((country) => {
      if (country.code === "UNKNOWN__" || country.code === "ZZ") return false;
      if (!search) return true;
      return (
        country.label.toLowerCase().includes(search) ||
        country.code.toLowerCase().includes(search)
      );
    }).slice(0, 50);
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
      setError(result.error ?? "Could not save country");
    },
    [close, disabled, onSelect, saving],
  );

  const menu =
    open && menuLayout
      ? createPortal(
          <>
            <button
              type="button"
              aria-label="Close country picker"
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
                  placeholder="Search countries"
                  className="w-full rounded-lg border border-hairline bg-white py-1.5 pl-8 pr-2 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-brand/40 focus:ring-2 focus:ring-brand/15"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") close();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (filtered[0]) void pick(filtered[0].code);
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
                  filtered.map((country) => {
                    const active = country.code === selectedCode;
                    return (
                      <li
                        key={country.code}
                        role="option"
                        aria-selected={active}
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void pick(country.code)}
                          disabled={saving}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-50",
                            active
                              ? "bg-brand/10 text-brand"
                              : "text-ink hover:bg-surface-subtle",
                          )}
                        >
                          <span className="font-medium">{country.label}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-ink-muted">
                              {country.code}
                            </span>
                            {active ? (
                              <Check className="size-3 text-brand" aria-hidden />
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })
                ) : (
                  <li className="px-2.5 py-3 text-xs text-ink-muted">
                    No country found.
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

  const countryLabel =
    !loading && (areaLabel?.trim() || selectedLabel)
      ? (areaLabel?.trim() ?? selectedLabel)
      : null;

  return (
    <div
      className="inline-flex min-w-0 max-w-[min(100%,18rem)] items-center"
      aria-label="Shipping region for catalog search"
    >
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
            : "Change shipping country for catalog search"
        }
        onClick={() => {
          if (disabled || loading) return;
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex h-8 min-w-0 items-center gap-1 rounded-full border border-hairline bg-white px-2.5 text-[11px] font-medium tracking-wide text-ink-secondary transition-colors",
          disabled
            ? "cursor-not-allowed opacity-55"
            : "hover:border-line-medium hover:bg-surface-tint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20",
        )}
      >
        <MapPin className="size-3 shrink-0" aria-hidden strokeWidth={1.75} />
        <span className="max-w-32 truncate sm:max-w-44">
          {loading
            ? "Area: Detecting…"
            : countryLabel
              ? `Area: ${countryLabel}${saving ? "…" : ""}`
              : "Area: Choose"}
        </span>
        {countryLabel && !saving ? (
          <Check
            className="size-3 shrink-0 text-success"
            aria-label="Area applied"
            strokeWidth={2}
          />
        ) : null}
        {countryLabel ? (
          <span className="hidden text-ink-muted xl:inline">(change)</span>
        ) : null}
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
