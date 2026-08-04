"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { useSearchParams } from "next/navigation";
import { useChatStore } from "@/components/chat/chat-store";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { MessageList } from "@/components/chat/MessageList";
import { ScrollToBottomButton } from "@/components/chat/ScrollToBottomButton";
import { EmptyChatState } from "@/components/chat/EmptyChatState";
import { HomeMobileActionGrid } from "@/components/chat/HomeQuickActions";
import { HomeRecentConversations } from "@/components/chat/HomeRecentConversations";
import { useChatScroll } from "@/components/chat/useChatScroll";
import { ChatFocusHighlightProvider } from "@/components/chat/ChatFocusHighlightContext";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { useChatScrollFocus } from "@/components/chat/useChatScrollFocus";
import { parseChatFocusFromSearchParams } from "@/lib/shared/chatFocus";
import { AppShell } from "@/components/layout/AppShell";
import {
  AgentDebugPanel,
  AgentDebugToggleRail,
} from "@/components/chat/AgentDebugPanel";

export const ChatLayout = memo(function ChatLayout() {
  const searchParams = useSearchParams();
  const scrollFocus = useMemo(() => {
    const fromHook = parseChatFocusFromSearchParams(searchParams);
    if (fromHook) return fromHook;
    if (typeof window !== "undefined") {
      return parseChatFocusFromSearchParams(
        new URLSearchParams(window.location.search),
      );
    }
    return null;
  }, [searchParams]);

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messages = useChatStore((s) => s.messages);
  const messageCount = messages.length;
  const loadingMessages = useChatStore((s) => s.loadingMessages);
  const error = useChatStore((s) => s.error);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const collapseInlineProduct = useInlineProductStore((s) => s.collapse);

  useEffect(() => {
    collapseInlineProduct();
  }, [activeConversationId, collapseInlineProduct]);

  const showEmpty = !activeConversationId && messageCount === 0;
  const showLoading = loadingMessages && messageCount === 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  const { highlight: focusHighlight, restoringFocus } = useChatScrollFocus({
    focus: scrollFocus,
    conversationId: activeConversationId,
    messages,
    loadingMessages,
    scrollContainerRef: scrollRef,
  });

  const pauseAutoScroll =
    scrollFocus != null ||
    restoringFocus ||
    focusHighlight != null ||
    showLoading;

  const { showScrollDown, scrollToBottom } = useChatScroll({
    scrollContainerRef: scrollRef,
    paused: pauseAutoScroll,
  });

  return (
    <AppShell>
      <ChatFocusHighlightProvider highlight={focusHighlight}>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <AgentDebugToggleRail />
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
              {error ? (
                <div
                  className={cn(
                    "mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-error-border bg-error-bg px-4 py-3 text-sm text-error-deep",
                    showEmpty && "absolute inset-x-0 top-0 z-30 shadow-lg",
                  )}
                  role="alert"
                >
                  <span>{error}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-ink/90"
                    onClick={() => {
                      useChatStore.setState({ error: null });
                      if (activeConversationId) {
                        void loadConversation(activeConversationId);
                      } else {
                        void fetchConversations();
                      }
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              <div className="relative min-h-0 flex-1">
                <div
                  ref={scrollRef}
                  className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
                >
                  <div
                    className={cn(
                      "tp-chat-content shoop-page-x relative mx-auto flex w-full flex-col gap-4 md:gap-5",
                      showEmpty
                        ? "min-h-full max-w-page-wide"
                        : "max-w-page md:min-h-full",
                    )}
                  >
                    {showLoading ? (
                      <div className="flex min-h-[40vh] items-center justify-center py-20 text-sm text-ink-muted">
                        Loading…
                      </div>
                    ) : showEmpty ? (
                      <EmptyChatState />
                    ) : (
                      <MessageList />
                    )}
                  </div>
                </div>

                {!showEmpty && !showLoading && showScrollDown ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center shoop-page-x">
                    <ScrollToBottomButton
                      onClick={() => scrollToBottom("smooth")}
                    />
                  </div>
                ) : null}
              </div>

              {showEmpty ? (
                <div className="mx-auto w-full max-w-page-narrow shrink-0 shoop-page-x lg:hidden">
                  <div className="flex flex-col gap-2.5 pb-[max(8px,env(safe-area-inset-bottom))] sm:gap-4 sm:pb-4">
                    <HomeMobileActionGrid />
                    <HomeRecentConversations />
                  </div>
                </div>
              ) : (
                <ChatComposer />
              )}
            </div>
          </div>
          <AgentDebugPanel />
        </div>
      </ChatFocusHighlightProvider>
    </AppShell>
  );
});
