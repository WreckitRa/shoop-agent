"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ComposerReplyChip } from "@/components/chat/ComposerReplyChip";
import { ReceiptPlusButton } from "@/components/chat/ReceiptPlusButton";
import { useChatStore } from "@/components/chat/chat-store";
import { useSuggestedPrompt } from "@/components/chat/useSuggestedPrompt";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";

const HOME_PLACEHOLDERS = [
  '"Day house party outfit… cool and comfy, under $250."',
  '"Beach wedding in Sardinia in May — guest, under $400."',
  '"Rebuild my work wardrobe — creative office, $600 total."',
  '"Everyday sneakers for wide feet — minimal, under $180."',
] as const;

export function ChatComposer({
  homeVariant,
  nested,
  stage,
}: {
  homeVariant?: "hero";
  /** Inside a padded column — skip outer page gutters. */
  nested?: boolean;
  /** 40/40/20 try-on stage — tighter chrome than home chat. */
  stage?: boolean;
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
  const clearComposerReplyContext = useChatStore(
    (s) => s.clearComposerReplyContext,
  );
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

  const focusAsk = useCallback(() => {
    ta.current?.focus({ preventScroll: true });
  }, []);

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
          ? "w-full max-w-[640px]"
          : stage
            ? "shrink-0 bg-transparent pb-3 pt-2"
            : "shrink-0 bg-page pb-3 pt-3"
      }
    >
      <div
        className={
          isHeroComposer
            ? "flex w-full flex-col gap-2 sm:gap-3"
            : cn(
                "mx-auto flex w-full flex-col gap-3",
                stage ? "max-w-none px-3 pb-3" : "max-w-page-narrow",
                !nested && "shoop-page-x",
              )
        }
      >
        <div
          className={cn(
            "shoop-buybrief-box",
            isHeroComposer && "shoop-buybrief-box--hero",
            stage && "shoop-buybrief-box--stage",
          )}
        >
          {!isHomeEmpty && !stage ? <ComposerBrandRow /> : null}
          {composerReplyContext ? (
            <ComposerReplyChip
              context={composerReplyContext}
              onRemove={clearComposerReplyContext}
              className="mb-2.5"
            />
          ) : null}
          {isHeroComposer ? (
            <p className="shoop-ask-label">
              <ShoopIcon size={22} className="rounded-[6px]" />
              ASK ME ANYTHING
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
              className={cn(
                "shoop-composer-textarea shoop-textarea-placeholder max-h-[200px] w-full resize-none overflow-hidden border-0 bg-transparent font-normal text-ink outline-none",
                isHeroComposer
                  ? "min-h-[44px] text-[15px] leading-[1.5] md:text-[15px]"
                  : "min-h-[28px] text-[16px] leading-[24px] md:text-[15px] md:leading-6",
              )}
            />
          </div>
          <div
            className={cn(
              "mt-3 flex items-center justify-between gap-2",
              isHeroComposer ? "min-h-11" : "shoop-composer-actions h-11",
            )}
          >
            {isHeroComposer ? (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2"
                role="group"
                aria-label="Ask shortcuts"
              >
                <ReceiptPlusButton variant="door" />
                <button
                  type="button"
                  className="shoop-ask-door"
                  onClick={() => {
                    setInput(
                      "Find me this look — I'll describe it (or share a photo next).",
                    );
                    focusAsk();
                  }}
                >
                  📷 Find me this
                </button>
                <button
                  type="button"
                  className="shoop-ask-door"
                  onClick={focusAsk}
                >
                  💬 Just tell me
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <ReceiptPlusButton />
              </div>
            )}
            {isStreaming ? (
              <StopButton onStop={() => void stopGeneration()} />
            ) : isHeroComposer ? (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={onSend}
                className="shoop-shoop-btn disabled:cursor-not-allowed disabled:opacity-40"
              >
                Shoop it
                <ArrowRight
                  className="shoop-shoop-btn__arr size-3.5"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </button>
            ) : (
              <SendIconButton
                disabled={!canSubmit}
                onClick={onSend}
                stage={stage}
              />
            )}
          </div>
        </div>

        {queuedSendText ? (
          <p className="text-center text-[11px] font-medium text-ink-secondary">
            Queued — sends after reply
          </p>
        ) : null}

        {isFirstMessage && !isHeroComposer ? <ComposerLegalFooter /> : null}
      </div>
    </div>
  );
}

function ComposerBrandRow() {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <ShoopIcon />
            <span className="sr-only">Ask Shoop</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SendIconButton({
  onClick,
  disabled,
  stage,
}: {
  onClick: () => void;
  disabled: boolean;
  stage?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label="Send message"
      className={cn(
        "shoop-composer-send shoop-composer-send--icon flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed",
        stage && "shoop-composer-send--stage",
      )}
    >
      <ArrowUpIcon inherit={stage} />
    </button>
  );
}

function ArrowUpIcon({ inherit }: { inherit?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4", inherit ? "text-current" : "text-white")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      aria-label="Stop generating"
      className="shoop-composer-stop flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-ink"
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
