import { isSupabaseAuthUserId } from "@/lib/fashion-memory/auth";
import {
  ensureSelfPerson,
  resolvePersonIdRef,
} from "@/lib/fashion-memory/people";
import { TryonCapError } from "./generations";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when value is a Postgres uuid (not a roster short id like #abcd). */
export function isTryonPersonUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Resolve brief recipient (#short / uuid) to a real people.id uuid for
 * tryon_generations.person_id. Falls back to self when the ref is missing
 * or unresolvable — try-on on the rail is always the shopper's avatar.
 */
export async function resolveTryonPersonId(
  userId: string,
  personRef: string | null | undefined,
): Promise<string> {
  const raw = personRef?.trim() ?? "";
  if (raw) {
    const resolved = await resolvePersonIdRef(userId, raw);
    if (resolved) return resolved;
  }
  return (await ensureSelfPerson(userId)).id;
}

/**
 * Same as resolveTryonPersonId, but never throws — guests and roster misses
 * return null so search/presentation can keep going without a twin.
 */
export async function tryResolveTryonPersonId(
  userId: string,
  personRef: string | null | undefined,
): Promise<string | null> {
  if (!isSupabaseAuthUserId(userId)) return null;
  try {
    const id = await resolveTryonPersonId(userId, personRef);
    return id.trim() ? id : null;
  } catch {
    return null;
  }
}

const FRIENDLY_BY_MESSAGE: Array<{ test: RegExp; message: string; status: number }> = [
  {
    test: /avatar required/i,
    message: "Finish The Fitting first so I can dress you.",
    status: 400,
  },
  {
    test: /ensureSelfPerson|supabase auth user id/i,
    message: "Finish The Fitting first so I can dress you.",
    status: 400,
  },
  {
    test: /try-on not enabled|outfit try-on not enabled|not enabled/i,
    message: "Try-on isn't available on this account yet.",
    status: 400,
  },
  {
    test: /search not found|look not found|pick not found/i,
    message: "That find isn't available anymore — pull another piece.",
    status: 400,
  },
  {
    test: /no supported garments|garment type not supported|none of the active/i,
    message: "I can't virtually dress that piece — try another.",
    status: 400,
  },
  {
    test: /no try-on provider/i,
    message: "Try-on is briefly unavailable — try again in a moment.",
    status: 503,
  },
  {
    test: /fitting room supports up to/i,
    message: "You can wear up to six pieces at once.",
    status: 400,
  },
];

function looksInternal(message: string): boolean {
  return (
    /prisma|uuid|inconsistent column|turbopack|__TURBOPACK|invocation in |at 1\b|db\.Uuid|ECONNREFUSED|ETIMEDOUT/i.test(
      message,
    ) || message.length > 180
  );
}

/**
 * Map any try-on failure to a short shopper-facing message.
 * Never leak Prisma / Turbopack / stack noise to the client.
 */
export function tryonUserFacingError(error: unknown): {
  message: string;
  status: number;
} {
  if (error instanceof TryonCapError) {
    return { message: error.message, status: 429 };
  }

  const raw = error instanceof Error ? error.message.trim() : "";
  if (raw) {
    for (const row of FRIENDLY_BY_MESSAGE) {
      if (row.test.test(raw)) {
        return { message: row.message, status: row.status };
      }
    }
    if (!looksInternal(raw)) {
      return { message: raw, status: 500 };
    }
  }

  return {
    message: "Couldn't dress this one — try another piece.",
    status: 500,
  };
}

export function tryonErrorResponse(error: unknown): Response {
  const { message, status } = tryonUserFacingError(error);
  return Response.json({ error: message }, { status });
}
