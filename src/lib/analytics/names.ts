/** Minimum product event set for North Star (Twin / 5 / 2) + sales ladder. */
export const PRODUCT_EVENT_NAMES = [
  "signup_completed",
  "photo_uploaded",
  "twin_render_started",
  "twin_render_completed",
  "twin_render_failed",
  "look_viewed",
  "item_reacted",
  "friend_ask_sent",
  "friend_vote_received",
  "checkout_start",
  "outbound_click",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export function isProductEventName(value: string): value is ProductEventName {
  return (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}
