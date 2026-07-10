export const NEW_CHAT_PATH = "/";

export function conversationPath(conversationId: string): string {
  return `/c/${conversationId}`;
}

/** Routes where the main chat composer is mounted (`/` or `/c/:id`). */
export function isChatRoutePathname(pathname: string): boolean {
  return pathname === NEW_CHAT_PATH || pathname.startsWith("/c/");
}

/** Reads `/c/:id` from the current pathname (App Router). */
export function parseConversationIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/c\/([^/?#]+)/);
  return match?.[1] ?? null;
}
