"use client";

import { useChatStore } from "@/components/chat/chat-store";
import {
  NEW_CHAT_PATH,
  parseConversationIdFromPath,
} from "@/lib/shared/chatRoutes";

/** Leave `/c/:id` so identity changes do not reload another user's conversation. */
export function leaveConversationRoute(): void {
  if (typeof window === "undefined") return;
  if (!parseConversationIdFromPath(window.location.pathname)) return;

  const { navigate, syncRouteConversationId } = useChatStore.getState();
  useChatStore.setState({ error: null });
  syncRouteConversationId(undefined);
  if (navigate) {
    navigate(NEW_CHAT_PATH);
  } else {
    window.location.replace(NEW_CHAT_PATH);
  }
}
