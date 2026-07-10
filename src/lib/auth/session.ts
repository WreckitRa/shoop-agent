import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import {
  guestUserIdFromSessionId,
  parseGuestSessionId,
} from "@/lib/auth/guest-session";

export async function getAuthUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export type AuthContext =
  | { ok: true; userId: string; email: string | null; isGuest: boolean }
  | { ok: false; response: Response };

async function getGuestSessionIdFromRequestHeaders(): Promise<string | null> {
  const h = await headers();
  return parseGuestSessionId(h.get("x-guest-session-id"));
}

export async function getAuthContext(): Promise<AuthContext> {
  const user = await getAuthUser();
  if (user) {
    return {
      ok: true,
      userId: user.id,
      email: user.email ?? null,
      isGuest: false,
    };
  }

  const guestSessionId = await getGuestSessionIdFromRequestHeaders();
  if (guestSessionId) {
    return {
      ok: true,
      userId: guestUserIdFromSessionId(guestSessionId),
      email: null,
      isGuest: true,
    };
  }

  return {
    ok: false,
    response: Response.json({ error: "Sign in required." }, { status: 401 }),
  };
}

export async function requireUserId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx.ok) throw new UnauthorizedError();
  return ctx.userId;
}

export class UnauthorizedError extends Error {
  readonly name = "UnauthorizedError";
}

export function unauthorizedJson() {
  return Response.json({ error: "Sign in required." }, { status: 401 });
}
