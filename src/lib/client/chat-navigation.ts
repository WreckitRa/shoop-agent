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
  goHome();
}

/** Logout always lands on `/`, from any route. */
export function resetToRoot(): void {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (path === NEW_CHAT_PATH) return;
  goHome();
}

function goHome(): void {
  const { navigate, syncRouteConversationId } = useChatStore.getState();
  useChatStore.setState({ error: null });
  syncRouteConversationId(undefined);
  if (navigate) {
    navigate(NEW_CHAT_PATH);
  } else {
    window.location.replace(NEW_CHAT_PATH);
  }
}
