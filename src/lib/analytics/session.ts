import { headers } from "next/headers";
import { parseGuestSessionId } from "@/lib/auth/guest-session";
import { ANALYTICS_SESSION_HEADER } from "./constants";

export { ANALYTICS_SESSION_HEADER } from "./constants";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accepted analytics session ids are plain UUIDs. */
export function parseAnalyticsSessionId(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || !UUID_RE.test(value)) return null;
  return value.toLowerCase();
}

/**
 * Resolve the analytics session for the current request.
 * Prefer X-Analytics-Session-Id; fall back to guest session UUID.
 * Returns null outside a request or when neither is present.
 */
export async function resolveAnalyticsSessionId(): Promise<string | null> {
  try {
    const h = await headers();
    const explicit = parseAnalyticsSessionId(h.get(ANALYTICS_SESSION_HEADER));
    if (explicit) return explicit;
    return parseGuestSessionId(h.get("x-guest-session-id"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/outside (a )?request|request scope|headers/i.test(message)) {
      return null;
    }
    throw error;
  }
}
