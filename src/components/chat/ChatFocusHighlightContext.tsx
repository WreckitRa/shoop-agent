"use client";

import { createContext, useContext } from "react";
import type { ChatFocusTarget } from "@/lib/shared/chatFocus";

const ChatFocusHighlightContext = createContext<ChatFocusTarget | null>(null);

export function ChatFocusHighlightProvider({
  highlight,
  children,
}: {
  highlight: ChatFocusTarget | null;
  children: React.ReactNode;
}) {
  return (
    <ChatFocusHighlightContext.Provider value={highlight}>
      {children}
    </ChatFocusHighlightContext.Provider>
  );
}

export function useChatFocusHighlight(): ChatFocusTarget | null {
  return useContext(ChatFocusHighlightContext);
}
