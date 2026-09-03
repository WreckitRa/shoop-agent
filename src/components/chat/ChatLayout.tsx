"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { useSearchParams } from "next/navigation";
import { useChatStore } from "@/components/chat/chat-store";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { MessageList } from "@/components/chat/MessageList";
import { ScrollToBottomButton } from "@/components/chat/ScrollToBottomButton";
import { EmptyChatState } from "@/components/chat/EmptyChatState";
import { HomeMirrorCard } from "@/components/chat/HomeMirrorCard";
import { FittingStage } from "@/components/tryon/FittingStage";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import {
  INLINE_FITTING_CARD_SLOT_ID,
  INLINE_FITTING_SLOT_ID,
  useInlineFittingStore,
} from "@/components/onboarding/inline-fitting-store";
import { useChatScroll } from "@/components/chat/useChatScroll";
import { ChatFocusHighlightProvider } from "@/components/chat/ChatFocusHighlightContext";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { useChatScrollFocus } from "@/components/chat/useChatScrollFocus";
import { parseChatFocusFromSearchParams } from "@/lib/shared/chatFocus";
import { AppShell } from "@/components/layout/AppShell";

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
  const tryOnOpen = useTryOnDrawerStore((s) => s.open);
  const fittingColumnOpen = useInlineFittingStore((s) => s.columnOpen);
  const stageLocked = useInlineFittingStore((s) => s.stageLocked);
  const twinDock = useInlineFittingStore((s) => s.twinDock);
  const closeFittingColumn = useInlineFittingStore((s) => s.requestDismiss);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    collapseInlineProduct();
  }, [activeConversationId, collapseInlineProduct]);

  useEffect(() => {
    if (activeConversationId || messageCount > 0) setPreviewUrl(null);
  }, [activeConversationId, messageCount]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (fittingColumnOpen) useTryOnDrawerStore.getState().close();
  }, [fittingColumnOpen]);

  const showEmpty = !activeConversationId && messageCount === 0;
  const showLoading = loadingMessages && messageCount === 0;
  const shopping = tryOnOpen && desktop && !fittingColumnOpen;
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

  const thread = (
    <>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
        >
          <div
            className={cn(
              "tp-chat-content relative flex w-full flex-col",
              fittingColumnOpen
                ? "gap-3 px-4 py-3.5"
                : "gap-4 md:gap-5",
            )}
            data-fitting-column={fittingColumnOpen ? "" : undefined}
          >
            {showLoading ? (
              <div className="flex min-h-[40vh] items-center justify-center py-20 text-sm text-ink-muted">
                Loading…
              </div>
            ) : showEmpty ? (
              <EmptyChatState
                previewUrl={previewUrl}
                onPreview={setPreviewUrl}
                compact={fittingColumnOpen}
              />
            ) : (
              <MessageList />
            )}
          </div>
        </div>

        {!showEmpty && !showLoading && showScrollDown ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
            <ScrollToBottomButton onClick={() => scrollToBottom("smooth")} />
          </div>
        ) : null}
      </div>

      {showEmpty ? null : (
        <ChatComposer nested stage={shopping || fittingColumnOpen} />
      )}
    </>
  );

  if (stageLocked) {
    return (
      <AppShell>
        <div className="min-h-0 flex-1 bg-white" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ChatFocusHighlightProvider highlight={focusHighlight}>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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

              {shopping ? (
                <div className="shoop-stage">
                  <section className="shoop-stage-col shoop-stage-col--chat">
                    {showEmpty ? null : (
                      <header className="shoop-chead">
                        <span className="shoop-croom__dot" aria-hidden />
                        <h2>Your stylist</h2>
                        <button
                          type="button"
                          className="shoop-chead__back"
                          onClick={() => useTryOnDrawerStore.getState().close()}
                        >
                          Full chat
                        </button>
                      </header>
                    )}
                    {thread}
                  </section>
                  <FittingStage layout="inline" peekUrl={previewUrl} />
                </div>
              ) : (
                <>
                  <div
                    className={cn(
                      "flex min-h-0 w-full flex-1 flex-col",
                      fittingColumnOpen
                        ? "min-h-0"
                        : "shoop-page-x mx-auto max-w-page-wide",
                    )}
                  >
                    <div
                      className={cn(
                        "grid min-h-0 flex-1 grid-cols-1",
                        fittingColumnOpen
                          ? stageLocked
                            ? "grid-rows-1 lg:grid-cols-1"
                            : "grid-rows-1 lg:grid-cols-[minmax(220px,0.42fr)_minmax(0,1fr)]"
                          : "lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch lg:gap-9",
                      )}
                    >
                      <div
                        className={cn(
                          "relative flex min-h-0 min-w-0 flex-col",
                          fittingColumnOpen &&
                            "overflow-hidden bg-[#F7F7F8] max-lg:hidden lg:border-r lg:border-[var(--fitting-line)]",
                          stageLocked && "hidden",
                        )}
                      >
                        {stageLocked ? null : thread}
                      </div>

                      <section
                        className={cn(
                          "relative min-h-0 overflow-hidden bg-white",
                          fittingColumnOpen
                            ? twinDock === "flow"
                              ? "grid grid-rows-1"
                              : "grid grid-rows-1 lg:grid-cols-[minmax(0,1fr)_minmax(230px,300px)]"
                            : "hidden",
                        )}
                      >
                        <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
                          {fittingColumnOpen && !stageLocked ? (
                            <button
                              type="button"
                              aria-label="Keep chatting"
                              onClick={closeFittingColumn}
                              className="absolute right-2.5 top-2.5 z-20 hidden size-8 place-items-center rounded-full border border-[var(--fitting-line)] bg-white text-[var(--fitting-quiet)] transition hover:text-[var(--fitting-ink)] lg:grid"
                            >
                              <span aria-hidden className="text-lg leading-none">
                                ×
                              </span>
                            </button>
                          ) : null}
                          <div
                            id={INLINE_FITTING_SLOT_ID}
                            className="flex min-h-0 flex-1 flex-col overflow-hidden"
                          />
                        </div>
                        <aside
                          className={cn(
                            "hidden min-h-0 min-w-0 flex-col overflow-hidden border-t border-[var(--fitting-line)] lg:flex lg:border-l lg:border-t-0",
                            twinDock === "flow" && "hidden",
                          )}
                        >
                          <div
                            id={INLINE_FITTING_CARD_SLOT_ID}
                            className="flex min-h-0 flex-1 flex-col overflow-hidden"
                          />
                        </aside>
                      </section>

                      {fittingColumnOpen ? null : (
                        <aside className="hidden min-h-0 py-7 lg:flex lg:flex-col">
                          <HomeMirrorCard
                            previewUrl={previewUrl}
                            compact={!showEmpty}
                          />
                        </aside>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </ChatFocusHighlightProvider>
    </AppShell>
  );
});
