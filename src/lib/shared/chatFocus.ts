import { conversationPath } from "@/lib/shared/chatRoutes";

/** Query keys for deep-linking back to a chat message (and optional product). */
export const CHAT_FOCUS_MSG_PARAM = "msg";
export const CHAT_FOCUS_PRODUCT_PARAM = "product";

export type ChatFocusTarget = {
  messageId: string;
  productId?: string;
};

/** Stable DOM id for a chat message row (used for scroll-into-view). */
export function chatMessageDomId(messageId: string): string {
  return `chat-msg-${messageId}`;
}

/** Stable DOM id for a product card inside a message. */
export function chatProductDomId(productId: string): string {
  return `chat-product-${encodeURIComponent(productId)}`;
}

/** Message ids are cuid-style strings from Prisma. */
export function isValidFocusMessageId(id: string): boolean {
  return /^[a-z0-9]{10,64}$/i.test(id);
}

export function isValidFocusProductId(id: string): boolean {
  return id.length > 0 && id.length <= 512;
}

export function parseChatFocusFromSearchParams(
  input: Pick<URLSearchParams, "get"> | null | undefined,
): ChatFocusTarget | null {
  if (!input) return null;
  const messageId = input.get(CHAT_FOCUS_MSG_PARAM)?.trim();
  if (!messageId || !isValidFocusMessageId(messageId)) return null;
  const rawProduct = input.get(CHAT_FOCUS_PRODUCT_PARAM)?.trim();
  const productId =
    rawProduct && isValidFocusProductId(rawProduct) ? rawProduct : undefined;
  return { messageId, productId };
}

/** Conversation URL that restores scroll to a message (and product card). */
export function buildChatReturnPath(
  conversationId: string,
  focus: ChatFocusTarget,
): string {
  const params = new URLSearchParams();
  params.set(CHAT_FOCUS_MSG_PARAM, focus.messageId);
  if (focus.productId) {
    params.set(CHAT_FOCUS_PRODUCT_PARAM, focus.productId);
  }
  return `${conversationPath(conversationId)}?${params.toString()}`;
}

const CHAT_FOCUS_SESSION_KEY = "shoop.chat.focusReturn";

export type ChatFocusReturnStash = ChatFocusTarget & {
  conversationId: string;
};

/** Persist focus target for browser-back (history) as well as deep links. */
export function stashChatFocusReturn(stash: ChatFocusReturnStash): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CHAT_FOCUS_SESSION_KEY, JSON.stringify(stash));
  } catch {
    /* quota / private mode */
  }
}

/** Drop a stashed return target when identity changes. */
export function clearChatFocusReturn() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CHAT_FOCUS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Read-once fallback when the chat URL has no focus query params. */
export function consumeChatFocusReturn(
  conversationId: string,
): ChatFocusTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CHAT_FOCUS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatFocusReturnStash>;
    if (parsed.conversationId !== conversationId) return null;
    if (!parsed.messageId || !isValidFocusMessageId(parsed.messageId)) return null;
    sessionStorage.removeItem(CHAT_FOCUS_SESSION_KEY);
    return {
      messageId: parsed.messageId,
      productId:
        parsed.productId && isValidFocusProductId(parsed.productId)
          ? parsed.productId
          : undefined,
    };
  } catch {
    return null;
  }
}
