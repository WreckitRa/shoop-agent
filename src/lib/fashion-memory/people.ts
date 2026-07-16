import { assertFashionRow, fashionMemoryDb } from "./db";
import { isSupabaseAuthUserId } from "./auth";
import {
  buildPersonShortIdMap,
  personShortId,
} from "./extraction/context-format";
import type { PersonRelation, PersonRow } from "./types";

function isPersonUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Resolve roster short ids (#abcd), full uuids, or legacy refs to a person uuid. */
export async function resolvePersonIdRef(
  userId: string,
  personRef: string,
): Promise<string | null> {
  // Guests must resolve via FashionLocalStore — never hit Postgres/auth people.
  if (!isSupabaseAuthUserId(userId)) return null;

  const ref = personRef.trim().replace(/^#/, "");
  if (!ref) return null;

  if (isPersonUuid(ref)) {
    const byId = await getPersonById(userId, ref);
    return byId?.id ?? null;
  }

  const people = await listPeopleForUser(userId);
  const byFull = people.find((p) => p.id === ref);
  if (byFull) return byFull.id;

  const shortMap = buildPersonShortIdMap(people);
  const fromShort = shortMap[ref.toLowerCase()];
  if (fromShort) return fromShort;

  const byShort = people.find(
    (p) => personShortId(p.id) === ref.toLowerCase(),
  );
  return byShort?.id ?? null;
}

/** Ensure the user has a relation='self' person row (lazy fallback if trigger missed). */
export async function ensureSelfPerson(userId: string): Promise<PersonRow> {
  if (!isSupabaseAuthUserId(userId)) {
    throw new Error(
      `ensureSelfPerson requires a Supabase auth user id (got ${userId.slice(0, 24)}…)`,
    );
  }
  const db = fashionMemoryDb();

  const existing = await db
    .from("people")
    .select("*")
    .eq("user_id", userId)
    .eq("relation", "self")
    .maybeSingle();

  if (existing.data) return existing.data as PersonRow;

  const { data: rpcData, error: rpcError } = await db.rpc(
    "fashion_ensure_self_person_for_user",
    { p_user_id: userId },
  );
  if (rpcError) {
    // RPC may not exist until migration runs — fall back to insert.
    void rpcData;
    const inserted = await db
      .from("people")
      .insert({ user_id: userId, relation: "self" })
      .select("*")
      .single();
    if (inserted.data) return inserted.data as PersonRow;
    if (inserted.error?.code === "23505") {
      const retry = await db
        .from("people")
        .select("*")
        .eq("user_id", userId)
        .eq("relation", "self")
        .single();
      return assertFashionRow("ensureSelfPerson", retry.data as PersonRow | null, retry.error);
    }
    throw new Error(inserted.error?.message ?? "Failed to create self person");
  }

  const refetch = await db
    .from("people")
    .select("*")
    .eq("user_id", userId)
    .eq("relation", "self")
    .single();

  return assertFashionRow("ensureSelfPerson", refetch.data as PersonRow | null, refetch.error);
}

export async function createPerson(params: {
  userId: string;
  relation: PersonRelation;
  name?: string | null;
  birthday?: string | null;
  notes?: string | null;
}): Promise<PersonRow> {
  if (params.relation === "self") {
    return ensureSelfPerson(params.userId);
  }

  const db = fashionMemoryDb();
  const row = await db
    .from("people")
    .insert({
      user_id: params.userId,
      relation: params.relation,
      name: params.name ?? null,
      birthday: params.birthday ?? null,
      notes: params.notes ?? null,
    })
    .select("*")
    .single();

  return assertFashionRow("createPerson", row.data as PersonRow | null, row.error);
}

/** Set display name on an existing person (never merges across relations). */
export async function updatePersonName(params: {
  userId: string;
  personId: string;
  name: string;
}): Promise<PersonRow | null> {
  const trimmed = params.name.trim();
  if (!trimmed || !isPersonUuid(params.personId)) return null;
  if (!isSupabaseAuthUserId(params.userId)) return null;
  const db = fashionMemoryDb();
  const ts = new Date().toISOString();
  const row = await db
    .from("people")
    .update({ name: trimmed, updated_at: ts })
    .eq("user_id", params.userId)
    .eq("id", params.personId)
    .select("*")
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return (row.data as PersonRow | null) ?? null;
}

export async function getPersonById(
  userId: string,
  personId: string,
): Promise<PersonRow | null> {
  if (!isPersonUuid(personId)) return null;
  if (!isSupabaseAuthUserId(userId)) return null;
  const db = fashionMemoryDb();
  const row = await db
    .from("people")
    .select("*")
    .eq("user_id", userId)
    .eq("id", personId)
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return (row.data as PersonRow | null) ?? null;
}

export async function findPersonByRelation(params: {
  userId: string;
  relation: PersonRelation;
  name?: string | null;
}): Promise<PersonRow | null> {
  const db = fashionMemoryDb();
  let q = db
    .from("people")
    .select("*")
    .eq("user_id", params.userId)
    .eq("relation", params.relation);
  if (params.name?.trim()) {
    q = q.ilike("name", params.name.trim());
  }
  const row = await q.limit(1).maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return (row.data as PersonRow | null) ?? null;
}

export async function resolvePerson(params: {
  userId: string;
  relation?: PersonRelation;
  name?: string | null;
  personId?: string;
}): Promise<PersonRow> {
  if (params.personId) {
    const resolved = await resolvePersonIdRef(params.userId, params.personId);
    if (resolved) {
      const byId = await getPersonById(params.userId, resolved);
      if (byId) return byId;
    }
    throw new Error(`Person not found: ${params.personId}`);
  }

  const relation = params.relation ?? "self";
  if (relation === "self") {
    return ensureSelfPerson(params.userId);
  }

  const name = params.name?.trim() || null;

  // Exact relation + name (never matches a different relation sharing the name).
  if (name) {
    const byName = await findPersonByRelation({
      userId: params.userId,
      relation,
      name,
    });
    if (byName) return byName;
  }

  const sameRelation = (await listPeopleForUser(params.userId)).filter(
    (p) => p.relation === relation,
  );

  // Singleton unnamed of this relation → attach the new name (first "my son").
  if (name && sameRelation.length === 1 && !sameRelation[0]!.name?.trim()) {
    const updated = await updatePersonName({
      userId: params.userId,
      personId: sameRelation[0]!.id,
      name,
    });
    if (updated) return updated;
  }

  if (!name && sameRelation[0]) return sameRelation[0];

  return createPerson({
    userId: params.userId,
    relation,
    name,
  });
}

export async function listPeopleForUser(userId: string): Promise<PersonRow[]> {
  if (!isSupabaseAuthUserId(userId)) return [];
  const db = fashionMemoryDb();
  const rows = await db
    .from("people")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (rows.error) throw new Error(rows.error.message);
  return (rows.data ?? []) as PersonRow[];
}

/** Marks one-time intake as sent — intake never runs again for this person. */
export async function markPersonIntakeCompleted(
  userId: string,
  personId: string,
): Promise<void> {
  const db = fashionMemoryDb();
  const ts = new Date().toISOString();
  const row = await db
    .from("people")
    .update({ intake_completed_at: ts, updated_at: ts })
    .eq("user_id", userId)
    .eq("id", personId);
  if (row.error) throw new Error(row.error.message);
}
