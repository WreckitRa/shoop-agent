import { getGuestSessionId } from "@/lib/client/guest-storage";

/** Adds guest session header when browsing as a guest (before account sign-in). */
export function guestFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const guestId = getGuestSessionId();
  if (!guestId) return fetch(input, init);

  const headers = new Headers(init?.headers);
  headers.set("X-Guest-Session-Id", guestId);
  return fetch(input, { ...init, headers });
}
