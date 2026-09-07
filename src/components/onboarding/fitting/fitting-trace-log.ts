"use client";

import { ANALYTICS_SESSION_HEADER } from "@/lib/analytics/constants";
import { getAnalyticsSessionId } from "@/lib/analytics/session-client";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import { useAppSessionStore } from "@/lib/client/app-session";
import { FITTING_TRACE_HEADER } from "@/lib/onboarding/fitting-trace-shared";
import {
  getFittingTraceId,
  isFittingTracePublicEnabled,
} from "./fitting-trace-id";

export function postFittingTraceEvent(
  event: string,
  payload: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined" || !isFittingTracePublicEnabled()) return;
  const traceId = getFittingTraceId();
  if (!traceId || !event.trim()) return;

  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set(FITTING_TRACE_HEADER, traceId);
  const analyticsSessionId = getAnalyticsSessionId();
  if (analyticsSessionId) {
    headers.set(ANALYTICS_SESSION_HEADER, analyticsSessionId);
  }
  const guestId = getGuestSessionId();
  const mode = useAppSessionStore.getState().mode;
  if (guestId && mode !== "authenticated") {
    headers.set("X-Guest-Session-Id", guestId);
  }

  void fetch("/api/onboarding/fitting-trace", {
    method: "POST",
    headers,
    body: JSON.stringify({
      events: [
        {
          t: new Date().toISOString(),
          event: event.trim().slice(0, 120),
          ...payload,
        },
      ],
    }),
    keepalive: true,
  }).catch(() => undefined);
}
