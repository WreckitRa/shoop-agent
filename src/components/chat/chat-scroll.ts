/** Distance from bottom (px) treated as "at bottom" for stick-to-bottom behavior. */
export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 120;

export function getChatDistanceFromBottom(container: HTMLElement): number {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight
  );
}

export function isNearChatBottom(
  container: HTMLElement,
  threshold = CHAT_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  return getChatDistanceFromBottom(container) < threshold;
}

export function scrollChatContainerToBottom(
  container: HTMLElement,
  behavior: ScrollBehavior = "auto",
): void {
  const top = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTo({ top, behavior });
}
