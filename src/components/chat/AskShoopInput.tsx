"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";
import { ReceiptPlusButton } from "@/components/chat/ReceiptPlusButton";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  /** Max visible lines when auto-growing (home + chat use the same cap). */
  maxLines?: number;
  mode?: "home" | "chat-followup";
  className?: string;
  /** When set in chat mode, overrides the default chat placeholder until cleared by parent. */
  composerPlaceholder?: string | null;
};

export function AskShoopInput({
  value,
  onChange,
  onSend,
  disabled,
  isStreaming,
  onStop,
  maxLines = 7,
  mode = "home",
  className,
  composerPlaceholder,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isChat = mode === "chat-followup";

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    const lineHeight =
      Number.parseFloat(window.getComputedStyle(el).lineHeight) || 20;
    const maxHeight = lineHeight * maxLines;
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxLines]);

  useEffect(() => {
    if (isStreaming || disabled) return;
    const active = document.activeElement;
    if (active === document.body || active === document.documentElement) {
      textareaRef.current?.focus();
    }
  }, [isStreaming, disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const t = value.trim();
        if (t && !disabled && !isStreaming) {
          onSend();
        }
      }
    },
    [value, disabled, isStreaming, onSend],
  );

  const canSend = !disabled && !isStreaming && value.trim().length > 0;

  return (
    <div
      className={cn(
        "relative w-full shrink-0 pb-2",
        !isChat && "mx-auto max-w-page-narrow shoop-page-x",
        isChat && "max-w-none",
        className,
      )}
    >
      <div className="shoop-buybrief-box">
        <div className="mb-1.5 flex items-center gap-1.5">
          <ShoopIcon />
          <span className="truncate text-[13px] font-bold text-ink-secondary">
            Ask Shoop
          </span>
        </div>

        <textarea
          ref={textareaRef}
          rows={2}
          placeholder={
            isChat && composerPlaceholder?.trim()
              ? composerPlaceholder
              : isChat
                ? "Message Shoop…"
                : "What are you shopping for?"
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="Ask Shoop"
          data-testid="chat-input"
          className="shoop-composer-textarea shoop-textarea-placeholder max-h-[200px] min-h-[48px] w-full resize-none overflow-hidden border-0 bg-transparent text-[17px] font-normal leading-[26px] text-ink outline-none"
        />

        <div className="mt-2.5 flex h-11 items-center justify-between">
          <ReceiptPlusButton />
          <div className="flex items-center">
          {isStreaming ? (
            <StopButton onStop={onStop} />
          ) : (
            <ShoopItButton
              onClick={() => {
                if (canSend) onSend();
              }}
              disabled={!canSend}
            />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShoopItButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Send message"
      data-testid="send-message"
      className="shoop-composer-send shoop-composer-send--icon flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed"
    >
      <ArrowUp className="size-4 text-white" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function StopButton({ onStop }: { onStop?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => onStop?.()}
      aria-label="Stop generating"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-ink"
    >
      <span className="size-2.5 rounded-[2px] bg-white" />
    </button>
  );
}
