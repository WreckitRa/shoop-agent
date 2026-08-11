import type { ToastPayload } from "@/lib/client/toast-store";

export const ORDERS_COMING_SOON_TOAST: ToastPayload = {
  emoji: "📦",
  title: "Orders are almost here",
  body: "Soon you'll track every purchase right on Shoop — no more digging through email.",
};

export const LISTS_COMING_SOON_TOAST: ToastPayload = {
  emoji: "✨",
  title: "Lists are on the way",
  body: "Save items from Shoop, watch prices change, and grab the best deal when it hits.",
};

export const SAVE_COMING_SOON_TOAST: ToastPayload = {
  emoji: "🔖",
  title: "Save — coming soon",
  body: "You'll be able to bookmark picks and come back to them from your profile.",
};

export const WATCH_COMING_SOON_TOAST: ToastPayload = {
  emoji: "👀",
  title: "Watch — coming soon",
  body: "Price and availability alerts for products you care about are on the way.",
};

export const HOLD_COMING_SOON_TOAST: ToastPayload = {
  emoji: "⏳",
  title: "Hold is coming soon",
  body: "Not live yet — soon I'll watch price, your size, and delivery for seven days after you say yes.",
};

export const LINK_COPIED_TOAST: ToastPayload = {
  emoji: "🔗",
  title: "Link copied",
  body: "Paste it anywhere to share this product.",
};
