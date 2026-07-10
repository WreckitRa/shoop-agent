"use client";

import { createContext, useContext } from "react";

const ChatMessageProductLinkContext = createContext<string | null>(null);

/** Scope product-card links to the assistant message that rendered them. */
export function ChatMessageProductLinkProvider({
  messageId,
  children,
}: {
  messageId: string;
  children: React.ReactNode;
}) {
  return (
    <ChatMessageProductLinkContext.Provider value={messageId}>
      {children}
    </ChatMessageProductLinkContext.Provider>
  );
}

export function useChatMessageProductLink(): string | null {
  return useContext(ChatMessageProductLinkContext);
}
