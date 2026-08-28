"use client";

export const ANALYTICS_SESSION_KEY = "shoop.analytics.session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable browser analytics session (UUID). Survives guest → auth. */
export function getAnalyticsSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = localStorage.getItem(ANALYTICS_SESSION_KEY)?.trim() ?? "";
    if (UUID_RE.test(existing)) return existing.toLowerCase();
    const next = crypto.randomUUID();
    localStorage.setItem(ANALYTICS_SESSION_KEY, next);
    return next;
  } catch {
    return null;
  }
}
