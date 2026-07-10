"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { ComposerReplyChip } from "@/components/chat/ComposerReplyChip";
import { FeelingMoodPicker } from "@/components/chat/FeelingMoodPicker";
import { ReceiptPlusButton } from "@/components/chat/ReceiptPlusButton";
import { SelectedCategoryChips } from "@/components/chat/SelectedCategoryChips";
import { useChatStore } from "@/components/chat/chat-store";
import { useSuggestedPrompt } from "@/components/chat/useSuggestedPrompt";
import { ShoopIcon } from "@/components/brand/ShoopBrand";

const HOME_PLACEHOLDER = "How can I help you shop today?";

export function ChatComposer({
  adjacentMarquee = false,
  homeBackdrop = false,
}: {
  adjacentMarquee?: boolean;
  homeBackdrop?: boolean;
}) {
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const queuedSendText = useChatStore((s) => s.queuedSendText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const messageCount = useChatStore((s) => s.messages.length);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const composerFocusNonce = useChatStore((s) => s.composerFocusNonce);
  const composerReplyContext = useChatStore((s) => s.composerReplyContext);
  const clearComposerReplyContext = useChatStore((s) => s.clearComposerReplyContext);
  const selectedCategories = useChatStore((s) => s.selectedCategories);
  const removeHomeCategory = useChatStore((s) => s.removeHomeCategory);

  const suggestedPlaceholder = useSuggestedPrompt();
  const isFirstMessage = messageCount === 0;
  const isHomeEmpty = !activeConversationId && messageCount === 0;

  const ta = useRef<HTMLTextAreaElement | null>(null);
  const wasStreamingRef = useRef(false);

  const resize = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [input, resize]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      ta.current?.focus({ preventScroll: true });
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const isNewChat = activeConversationId === null && messageCount === 0;

  useEffect(() => {
    if (isStreaming || !isNewChat) return;
    const frame = requestAnimationFrame(() => {
      ta.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isNewChat, isStreaming, composerFocusNonce, activeConversationId]);

  useEffect(() => {
    if (!composerReplyContext) return;
    const frame = requestAnimationFrame(() => {
      ta.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [composerReplyContext]);

  const onSend = useCallback(() => {
    void sendMessage();
    requestAnimationFrame(() => {
      ta.current?.focus({ preventScroll: true });
      resize();
    });
  }, [resize, sendMessage]);

  const canSubmit = input.trim().length > 0;
  const placeholder = isStreaming
    ? "Type your next message…"
    : isHomeEmpty
      ? HOME_PLACEHOLDER
      : suggestedPlaceholder;

  return (
    <div
      className={
        homeBackdrop
          ? "relative z-10 shrink-0 bg-transparent pb-[max(12px,env(safe-area-inset-bottom))] pt-0"
          : adjacentMarquee
            ? "shrink-0 bg-page pb-[max(12px,env(safe-area-inset-bottom))] pt-0"
            : "shrink-0 bg-page pb-[max(12px,env(safe-area-inset-bottom))] pt-3"
      }
    >
      <div className="mx-auto flex w-full max-w-page-narrow flex-col gap-3 shoop-page-x">
        <div className="shoop-buybrief-box">
          {!isHomeEmpty ? (
            <ComposerBrandRow
              selectedCategories={selectedCategories}
              onRemoveCategory={removeHomeCategory}
            />
          ) : selectedCategories.length > 0 ? (
            <div className="mb-2">
              <SelectedCategoryChips
                selectedCategories={selectedCategories}
                onRemove={removeHomeCategory}
              />
            </div>
          ) : null}
          {composerReplyContext ? (
            <ComposerReplyChip
              context={composerReplyContext}
              onRemove={clearComposerReplyContext}
              className="mb-2.5"
            />
          ) : null}
          <textarea
            ref={ta}
            rows={isHomeEmpty ? 1 : 2}
            placeholder={placeholder}
            value={input}
            aria-busy={isStreaming || undefined}
            aria-label="Ask Shoop"
            onChange={(e) => {
              setInput(e.target.value);
              resize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) onSend();
              }
            }}
            className="shoop-composer-textarea shoop-textarea-placeholder max-h-[200px] min-h-[28px] w-full resize-none overflow-hidden border-0 bg-transparent text-[16px] font-normal leading-[24px] text-ink outline-none md:text-[15px] md:leading-6"
          />
          <div className="mt-2.5 flex h-11 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <ReceiptPlusButton />
              {!isHomeEmpty ? <FeelingMoodPicker /> : null}
            </div>
            {isStreaming ? (
              <StopButton onStop={() => void stopGeneration()} />
            ) : (
              <SendIconButton disabled={!canSubmit} onClick={onSend} />
            )}
          </div>
        </div>

        {queuedSendText ? (
          <p className="text-center text-[11px] font-medium text-ink-secondary">
            Queued — sends after reply
          </p>
        ) : null}

        {isFirstMessage ? <ComposerLegalFooter /> : null}
      </div>
    </div>
  );
}

function ComposerBrandRow({
  selectedCategories,
  onRemoveCategory,
}: {
  selectedCategories: string[];
  onRemoveCategory: (name: string) => void;
}) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <ShoopIcon />
            <span className="sr-only">Ask Shoop</span>
          </div>
        </div>
        <SelectedCategoryChips
          selectedCategories={selectedCategories}
          onRemove={onRemoveCategory}
        />
      </div>
    </div>
  );
}

function SendIconButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label="Send message"
      className="shoop-composer-send shoop-composer-send--icon flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed"
    >
      <ArrowUp className="size-4 text-white" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      aria-label="Stop generating"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-ink"
    >
      <span className="size-2.5 rounded-[2px] bg-white" />
    </button>
  );
}

function ComposerLegalFooter() {
  return (
    <p className="px-2 text-center text-[11px] leading-5 text-ink-muted">
      Shoop may make mistakes. Please review important details.{" "}
      <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
        Terms
      </Link>
      {" · "}
      <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
        Privacy
      </Link>
    </p>
  );
}
