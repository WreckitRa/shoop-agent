import { createHmac, timingSafeEqual } from "node:crypto";

export const GUEST_USER_ID_PREFIX = "guest-";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Signed token format: `{uuid}.{hex-hmac-sha256}` */
const SIGNED_TOKEN_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/i;

function getGuestHmacSecret(): string | null {
  return process.env.GUEST_SESSION_HMAC_SECRET?.trim() || null;
}

/**
 * Sign a guest UUID with HMAC-SHA256 using GUEST_SESSION_HMAC_SECRET.
 * Returns the signed token `{uuid}.{signature}` if the secret is configured,
 * or the plain UUID as a fallback so existing deployments keep working.
 */
export function signGuestSessionId(uuid: string): string {
  const secret = getGuestHmacSecret();
  if (!secret) return uuid;
  const sig = createHmac("sha256", secret).update(uuid).digest("hex");
  return `${uuid}.${sig}`;
}

/**
 * Verify and extract the UUID from a signed guest token.
 * Accepts both signed tokens (`uuid.sig`) and plain UUIDs (legacy / no secret configured).
 * Returns the UUID string or null if the token is invalid or the signature fails.
 */
export function parseGuestSessionId(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const token = raw.trim();
  const secret = getGuestHmacSecret();

  if (secret) {
    const match = SIGNED_TOKEN_RE.exec(token);
    if (!match) return null;
    const uuid = match[1];
    const providedSig = match[2];
    if (!uuid || !providedSig) return null;
    const expectedSig = createHmac("sha256", secret).update(uuid).digest("hex");
    try {
      const ok = timingSafeEqual(
        Buffer.from(providedSig.toLowerCase()),
        Buffer.from(expectedSig),
      );
      return ok ? uuid : null;
    } catch {
      return null;
    }
  }

  // No secret configured — accept plain UUID for backward compatibility.
  return UUID_RE.test(token) ? token : null;
}

/** Client-safe check: plain UUID or signed `{uuid}.{sig}` token shape. */
export function isValidGuestSessionToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (UUID_RE.test(t)) return true;
  return SIGNED_TOKEN_RE.test(t);
}

export function guestUserIdFromSessionId(sessionId: string): string {
  return `${GUEST_USER_ID_PREFIX}${sessionId}`;
}

export function isGuestUserId(userId: string): boolean {
  return userId.startsWith(GUEST_USER_ID_PREFIX);
}
