"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-hairline bg-white",
        "shadow-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SettingsCardHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b border-hairline px-5 py-5 sm:px-6">
      <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-xs leading-5 text-ink-muted">{description}</p>
      ) : null}
    </div>
  );
}

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2.5 px-5 py-4 sm:px-6">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-5 text-ink-muted">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingsDivider() {
  return <div className="mx-5 h-px bg-hairline-soft sm:mx-6" />;
}

export function SettingsInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "input w-full rounded-xl border-hairline bg-surface-subtle/50 px-3.5",
        "placeholder:text-ink-muted focus:border-ink/30 focus:bg-white focus:ring-2 focus:ring-ink/5",
        props.className,
      )}
    />
  );
}

export type OptionChip = { value: string; label: string };

export function ProfileOptionChips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly OptionChip[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2.5" role="radiogroup" aria-label={label}>
      <div className="flex flex-wrap gap-2">
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
                "rounded-full px-3.5 py-1.5 text-sm transition-all duration-150 ease-ios active:scale-[0.98]",
                active
                  ? "bg-ink font-medium text-white shadow-[0_2px_8px_rgba(26,26,46,0.18)]"
                  : "bg-surface-tint text-ink-soft hover:bg-hairline-soft hover:text-ink",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsActionRow({
  title,
  subtitle,
  destructive = false,
  onClick,
}: {
  title: string;
  subtitle: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors sm:px-6",
        "hover:bg-surface-subtle/80",
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            destructive ? "text-error-deep" : "text-ink",
          )}
        >
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-ink-muted">{subtitle}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
    </button>
  );
}

const ERASE_SUMMARY =
  "Deletes chats, memory, cart, and profile data. Your login stays active.";

const DELETE_SUMMARY =
  "Permanently deletes your account and all data. This cannot be undone.";

export function DangerActionModal({
  open,
  variant,
  password,
  onPasswordChange,
  error,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  variant: "erase" | "delete";
  password: string;
  onPasswordChange: (v: string) => void;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isDelete = variant === "delete";
  const title = isDelete ? "Delete account?" : "Erase all content?";
  const summary = isDelete ? DELETE_SUMMARY : ERASE_SUMMARY;
  const confirmLabel = isDelete ? "Delete account" : "Erase content";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-ink/45 backdrop-blur-md"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="danger-modal-title"
        aria-describedby="danger-modal-desc"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-error-border bg-white shadow-[0_24px_64px_rgba(14, 14, 17,0.22)]"
      >
        <div className="border-b border-error-border bg-error-bg px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-error/10 text-error-deep">
              <AlertTriangle className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2
                id="danger-modal-title"
                className="text-lg font-semibold tracking-tight text-error-deep"
              >
                {title}
              </h2>
              <p id="danger-modal-desc" className="mt-1.5 text-sm leading-5 text-error-deep/90">
                {summary}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-error-deep/70 transition hover:bg-error/10 hover:text-error-deep disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-secondary">
              Password to confirm
            </span>
            <SettingsInput
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
            />
          </label>

          {error ? <p className="text-sm text-error-deep">{error}</p> : null}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="btn-secondary h-11 px-5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || !password.trim()}
              className="inline-flex h-11 items-center justify-center rounded-full bg-error-deep px-5 text-sm font-semibold text-white transition hover:bg-error-deep/90 disabled:opacity-50"
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ProfileHeroSkeleton() {
  return (
    <div className="flex flex-col items-center py-2">
      <div className="size-20 animate-pulse rounded-full bg-surface-tint" />
      <div className="mt-4 h-5 w-36 animate-pulse rounded-md bg-surface-tint" />
      <div className="mt-2 h-4 w-48 animate-pulse rounded-md bg-surface-tint" />
    </div>
  );
}

export function SettingsCardSkeleton() {
  return (
    <SettingsCard>
      <div className="space-y-4 px-5 py-5 sm:px-6">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-tint" />
        <div className="h-11 animate-pulse rounded-xl bg-surface-tint" />
        <div className="h-20 animate-pulse rounded-xl bg-surface-tint" />
        <div className="h-12 animate-pulse rounded-xl bg-surface-tint" />
      </div>
    </SettingsCard>
  );
}

export function StickySaveBar({
  visible,
  saving,
  saved,
  canSave,
  onDiscard,
  onSave,
}: {
  visible: boolean;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  if (!visible && !saved) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-30 border-t border-hairline bg-white/92 backdrop-blur-xl",
        "bottom-[var(--shoop-tabbar-h,0px)] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3",
        "transition-transform duration-300 ease-ios",
        visible || saved ? "translate-y-0" : "translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 sm:px-6">
        <p className="text-sm text-ink-secondary">
          {saved ? "All changes saved" : "Unsaved changes"}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {visible && !saved ? (
            <>
              <button
                type="button"
                onClick={onDiscard}
                disabled={saving}
                className="btn-secondary h-11 px-4 text-xs"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!canSave || saving}
                className="btn-primary h-11 px-5 text-xs"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : saved ? (
            <span className="text-xs font-medium text-success-dark">Saved</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
