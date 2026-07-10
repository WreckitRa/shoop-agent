"use client";

import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Copy, Pencil, RotateCcw } from "lucide-react";
import type { ChatMessage } from "@/lib/ai-chat/types";
import { cn } from "@/lib/ai-chat/cn";

export const MessageActions = memo(function MessageActions({
  message,
  showActions,
  onCopy,
  onRegenerate,
  onEdit,
}: {
  message: ChatMessage;
  showActions: boolean;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!showActions) return null;

  const handleCopy = onCopy
    ? async () => {
        await onCopy();
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }
    : undefined;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {message.role === "assistant" ? (
        <ActionIcon label={copied ? "Copied" : "Copy"} onClick={handleCopy}>
          <Copy className="size-4" />
        </ActionIcon>
      ) : null}
      {message.role === "assistant" ? (
        <ActionIcon label="Regenerate" onClick={onRegenerate}>
          <RotateCcw className="size-4" />
        </ActionIcon>
      ) : null}
      {message.role === "user" ? (
        <ActionIcon label="Edit" onClick={onEdit}>
          <Pencil className="size-4" />
        </ActionIcon>
      ) : null}
    </div>
  );
});

function ActionIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
        !onClick && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function EditUserInline({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (next: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ta = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  const save = useCallback(() => {
    const t = value.trim();
    if (!t) return;
    onSave(t);
  }, [onSave, value]);

  return (
    <div className="flex w-full max-w-[min(760px,100%)] flex-col gap-2 justify-self-end rounded-2xl bg-neutral-900 p-3 text-white ring-1 ring-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:ring-neutral-200">
      <textarea
        ref={ta}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={4}
        className="w-full resize-y rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none ring-1 ring-neutral-700 focus:ring-2 focus:ring-blue-500 dark:bg-white dark:text-neutral-900 dark:ring-neutral-300"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          Enter to save · Shift+Enter for newline · Esc to cancel
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 dark:text-neutral-600 dark:hover:bg-neutral-200"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
            onClick={save}
          >
            Save & resend
          </button>
        </div>
      </div>
    </div>
  );
}
