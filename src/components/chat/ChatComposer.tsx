"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { ComposerReplyChip } from "@/components/chat/ComposerReplyChip";
import { FeelingMoodPicker } from "@/components/chat/FeelingMoodPicker";
import { ReceiptPlusButton } from "@/components/chat/ReceiptPlusButton";
import { SelectedCategoryChips } from "@/components/chat/SelectedCategoryChips";
import { useChatStore } from "@/components/chat/chat-store";
import { useSuggestedPrompt } from "@/components/chat/useSuggestedPrompt";
import { ShoopIcon } from "@/components/brand/ShoopBrand";

const HOME_PLACEHOLDERS = [
  "Beach wedding in Sardinia in May — guest, under $400, polished but not overdressed…",
  "Rebuild my work wardrobe — warm undertone, creative office, $600 total…",
  "Find everyday sneakers for wide feet — lots of walking, minimal, under $180…",
  "Anniversary gift for my wife — sculptural jewelry, gold, thoughtful, under $300…",
] as const;

export function ChatComposer({ homeVariant }: { homeVariant?: "hero" }) {
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
  const clearComposerReplyContext = useChatStore(
    (s) => s.clearComposerReplyContext,
  );
  const selectedCategories = useChatStore((s) => s.selectedCategories);
  const removeHomeCategory = useChatStore((s) => s.removeHomeCategory);
  const [homePlaceholderIndex, setHomePlaceholderIndex] = useState(0);

  const suggestedPlaceholder = useSuggestedPrompt();
  const isFirstMessage = messageCount === 0;
  const isHomeEmpty = !activeConversationId && messageCount === 0;
  const isHeroComposer = isHomeEmpty && homeVariant === "hero";

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
    if (!isHomeEmpty || isStreaming) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;

    const interval = window.setInterval(() => {
      setHomePlaceholderIndex(
        (current) => (current + 1) % HOME_PLACEHOLDERS.length,
      );
    }, 4500);

    return () => window.clearInterval(interval);
  }, [isHomeEmpty, isStreaming]);

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
      ? HOME_PLACEHOLDERS[homePlaceholderIndex]
      : suggestedPlaceholder;

  return (
    <div
      className={
        isHeroComposer
          ? "w-full"
          : "shrink-0 bg-page pb-[max(12px,env(safe-area-inset-bottom))] pt-3"
      }
    >
      <div
        className={
          isHeroComposer
            ? "shoop-hero-composer flex w-full flex-col gap-2 sm:gap-3"
            : "mx-auto flex w-full max-w-page-narrow flex-col gap-3 shoop-page-x"
        }
      >
        <div
          className={`shoop-buybrief-box${
            isHeroComposer ? " shoop-buybrief-box--hero" : ""
          }`}
        >
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
          {isHeroComposer ? (
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted sm:mb-3 sm:text-[11px]">
              Start your search
            </p>
          ) : null}
          <div>
            <textarea
              ref={ta}
              rows={isHeroComposer ? 2 : isHomeEmpty ? 1 : 2}
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
          </div>
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

        {isHeroComposer ? (
          <p className="px-2 text-center text-[12px] leading-relaxed text-ink-secondary sm:text-[13px]">
            Loyal to you, not the store — every pick explained, every price
            checked.
          </p>
        ) : null}

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
      <Link
        href="/terms"
        className="underline underline-offset-2 hover:text-ink"
      >
        Terms
      </Link>
      {" · "}
      <Link
        href="/privacy"
        className="underline underline-offset-2 hover:text-ink"
      >
        Privacy
      </Link>
    </p>
  );
}
