"use client";

import { guestFetch } from "@/lib/client/guest-fetch";
import type { ProductEventName } from "./names";

export {
  ANALYTICS_SESSION_KEY,
  getAnalyticsSessionId,
} from "./session-client";

/** Fire a client-originated product event via the analytics API. Best-effort. */
export function trackClientEvent(
  name: ProductEventName,
  props?: Record<string, unknown>,
): void {
  void guestFetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, props: props ?? {} }),
  }).catch(() => {});
}
