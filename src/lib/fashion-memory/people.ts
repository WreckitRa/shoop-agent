import { assertFashionRow, fashionMemoryDb } from "./db";
import type { PersonRelation, PersonRow } from "./types";

/** Ensure the user has a relation='self' person row (lazy fallback if trigger missed). */
export async function ensureSelfPerson(userId: string): Promise<PersonRow> {
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

export async function getPersonById(
  userId: string,
  personId: string,
): Promise<PersonRow | null> {
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
    const byId = await getPersonById(params.userId, params.personId);
    if (byId) return byId;
    throw new Error(`Person not found: ${params.personId}`);
  }

  const relation = params.relation ?? "self";
  if (relation === "self") {
    return ensureSelfPerson(params.userId);
  }

  const match = await findPersonByRelation({
    userId: params.userId,
    relation,
    name: params.name,
  });
  if (match) return match;

  return createPerson({
    userId: params.userId,
    relation,
    name: params.name,
  });
}

export async function listPeopleForUser(userId: string): Promise<PersonRow[]> {
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
