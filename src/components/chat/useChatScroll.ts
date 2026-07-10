"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useChatStore } from "@/components/chat/chat-store";
import {
  isNearChatBottom,
  scrollChatContainerToBottom,
} from "@/components/chat/chat-scroll";

function scheduleScrollToBottom(
  container: HTMLElement,
  behavior: ScrollBehavior,
): void {
  requestAnimationFrame(() => {
    scrollChatContainerToBottom(container, behavior);
    requestAnimationFrame(() => {
      scrollChatContainerToBottom(container, behavior);
    });
  });
}

export function useChatScroll(args: {
  scrollContainerRef: RefObject<HTMLElement | null>;
  paused?: boolean;
}) {
  const { scrollContainerRef, paused = false } = args;

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messages = useChatStore((s) => s.messages);
  const messageCount = messages.length;
  const draftLength = useChatStore((s) => s.streamingDraft.length);
  const streamTargetId = useChatStore((s) => s.streamingAssistantMessageId);

  const [showScrollDown, setShowScrollDown] = useState(false);
  const stickToBottomRef = useRef(true);
  const lastUserMessageIdRef = useRef<string | null>(null);

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current;
    if (!container) return;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    scheduleScrollToBottom(container, behavior);
  }, [scrollContainerRef]);

  useEffect(() => {
    lastUserMessageIdRef.current = null;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
  }, [activeConversationId]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const syncScrollState = () => {
      const near = isNearChatBottom(container);
      stickToBottomRef.current = near;
      setShowScrollDown(!near);
    };

    syncScrollState();
    container.addEventListener("scroll", syncScrollState, { passive: true });
    window.addEventListener("resize", syncScrollState);
    return () => {
      container.removeEventListener("scroll", syncScrollState);
      window.removeEventListener("resize", syncScrollState);
    };
  }, [scrollContainerRef, messageCount]);

  useEffect(() => {
    if (paused || !lastUserMessageId) return;
    if (lastUserMessageIdRef.current === lastUserMessageId) return;
    lastUserMessageIdRef.current = lastUserMessageId;
    scrollToBottom("auto");
  }, [lastUserMessageId, paused, scrollToBottom]);

  useEffect(() => {
    if (paused || !stickToBottomRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    scheduleScrollToBottom(container, "auto");
  }, [
    draftLength,
    messageCount,
    paused,
    scrollContainerRef,
    streamTargetId,
  ]);

  return { showScrollDown, scrollToBottom };
}
