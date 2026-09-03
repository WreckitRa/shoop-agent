import {
  GUEST_USER_ID_PREFIX,
  parseGuestSessionId,
} from "@/lib/auth/guest-session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Supabase auth user — fashion rows live in Postgres. */
export function isSupabaseAuthUserId(userId: string): boolean {
  return (
    UUID_RE.test(userId) && !userId.startsWith(GUEST_USER_ID_PREFIX)
  );
}

/** Guest user — fashion rows live in localStorage until login. */
export function isFashionMemoryGuestUserId(userId: string): boolean {
  return userId.startsWith(GUEST_USER_ID_PREFIX);
}

/**
 * UUID owner for people / avatar / try-on columns.
 * Guest app ids are `guest-{uuid}`; the uuid part is what those tables store.
 */
export function fashionOwnerUserId(userId: string): string | null {
  if (isSupabaseAuthUserId(userId)) return userId;
  if (!isFashionMemoryGuestUserId(userId)) return null;
  const rest = userId.slice(GUEST_USER_ID_PREFIX.length);
  if (UUID_RE.test(rest)) return rest;
  return parseGuestSessionId(rest);
}
