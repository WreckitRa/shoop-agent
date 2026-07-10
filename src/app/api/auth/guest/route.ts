import { randomUUID } from "node:crypto";
import { signGuestSessionId } from "@/lib/auth/guest-session";

export const dynamic = "force-dynamic";

/**
 * Issues a signed guest session token.
 *
 * The client calls this endpoint on first visit and stores the returned token
 * in localStorage. On subsequent API requests the token is sent via the
 * `X-Guest-Session-Id` header. The server validates the HMAC signature before
 * accepting the identity.
 *
 * When GUEST_SESSION_HMAC_SECRET is not configured the token degrades to a
 * plain UUID for backward compatibility.
 */
export async function POST() {
  const uuid = randomUUID();
  const token = signGuestSessionId(uuid);
  return Response.json({ token }, { status: 201 });
}
