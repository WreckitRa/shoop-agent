"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { conversationPath } from "@/lib/shared/chatRoutes";
import {
  chatMessageDomId,
  chatProductDomId,
  consumeChatFocusReturn,
  type ChatFocusTarget,
} from "@/lib/shared/chatFocus";
import type { ChatMessage } from "@/lib/ai-chat/types";

const HIGHLIGHT_MS = 2600;
/** Retry scroll until message/product nodes mount after client navigation. */
const MAX_SCROLL_ATTEMPTS = 48;

function focusScrollKey(focus: ChatFocusTarget): string {
  return `${focus.messageId}\0${focus.productId ?? ""}`;
}

/**
 * When the user returns from a product page, scroll the chat to the message
 * (and product card) they came from — similar to WhatsApp / ChatGPT reply focus.
 */
export function useChatScrollFocus(args: {
  focus: ChatFocusTarget | null;
  conversationId: string | null;
  messages: ChatMessage[];
  loadingMessages: boolean;
  scrollContainerRef: RefObject<HTMLElement | null>;
}): {
  highlight: ChatFocusTarget | null;
  /** True while a return-from-PDP scroll is queued or running. */
  restoringFocus: boolean;
} {
  const { focus, conversationId, messages, loadingMessages, scrollContainerRef } =
    args;
  const router = useRouter();
  const [resolvedFocus, setResolvedFocus] = useState<ChatFocusTarget | null>(
    focus,
  );
  const [highlight, setHighlight] = useState<ChatFocusTarget | null>(null);
  const consumedKeyRef = useRef<string | null>(null);
  const stashCheckedRef = useRef(false);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setResolvedFocus(focus);
    if (focus) {
      stashCheckedRef.current = true;
      consumedKeyRef.current = null;
    }
  }, [focus]);

  useEffect(() => {
    if (focus || !conversationId || stashCheckedRef.current) return;
    stashCheckedRef.current = true;
    const stashed = consumeChatFocusReturn(conversationId);
    if (stashed) {
      consumedKeyRef.current = null;
      setResolvedFocus(stashed);
    }
  }, [focus, conversationId]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!resolvedFocus || !conversationId || loadingMessages) return;

    const key = focusScrollKey(resolvedFocus);
    if (consumedKeyRef.current === key) return;

    const messageExists = messages.some((m) => m.id === resolvedFocus.messageId);
    if (!messageExists) return;

    let cancelled = false;
    let attempts = 0;

    const finishScroll = (target: HTMLElement) => {
      consumedKeyRef.current = key;

      const container = scrollContainerRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetCenter =
          targetRect.top -
          containerRect.top +
          container.scrollTop +
          targetRect.height / 2;
        const nextTop = Math.max(
          0,
          targetCenter - container.clientHeight * 0.38,
        );
        container.scrollTo({ top: nextTop, behavior: "smooth" });
      } else {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      setHighlight(resolvedFocus);
      setResolvedFocus(null);
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlight(null);
        highlightTimerRef.current = null;
      }, HIGHLIGHT_MS);

      if (focus) {
        router.replace(conversationPath(conversationId), { scroll: false });
      }
    };

    const attemptScroll = () => {
      if (cancelled) return;
      attempts += 1;

      const productEl = resolvedFocus.productId
        ? document.getElementById(chatProductDomId(resolvedFocus.productId))
        : null;
      const messageEl = document.getElementById(
        chatMessageDomId(resolvedFocus.messageId),
      );
      const target = productEl ?? messageEl;

      if (!target) {
        if (attempts < MAX_SCROLL_ATTEMPTS) {
          requestAnimationFrame(attemptScroll);
        }
        return;
      }

      finishScroll(target);
    };

    const t = window.setTimeout(() => {
      requestAnimationFrame(attemptScroll);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [
    resolvedFocus,
    focus,
    conversationId,
    loadingMessages,
    messages,
    router,
    scrollContainerRef,
  ]);

  return {
    highlight,
    restoringFocus: resolvedFocus != null,
  };
}
