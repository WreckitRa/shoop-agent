import { assertFashionRow, fashionMemoryDb } from "./db";
import type {
  FashionFactRow,
  FashionFactType,
  FashionFactValue,
} from "./types";

function garmentKey(garmentType: string | null | undefined): string | null {
  const g = garmentType?.trim();
  return g ? g.toLowerCase() : null;
}

/**
 * Override rule: same (person_id, fact_type, garment_type) supersedes the old
 * active row and inserts a new one. Never hard-deletes.
 */
export async function upsertFashionFact<T extends FashionFactType>(params: {
  userId: string;
  personId: string;
  factType: T;
  garmentType?: string | null;
  value: FashionFactValue<T>;
  sourceQuote?: string | null;
}): Promise<FashionFactRow<T>> {
  const db = fashionMemoryDb();
  const garment = garmentKey(params.garmentType);

  let activeQuery = db
    .from("fashion_facts")
    .select("id")
    .eq("user_id", params.userId)
    .eq("person_id", params.personId)
    .eq("fact_type", params.factType)
    .eq("status", "active");

  activeQuery = garment
    ? activeQuery.eq("garment_type", garment)
    : activeQuery.is("garment_type", null);

  const active = await activeQuery.maybeSingle();

  const inserted = await db
    .from("fashion_facts")
    .insert({
      user_id: params.userId,
      person_id: params.personId,
      fact_type: params.factType,
      garment_type: garment,
      value: params.value,
      source_quote: params.sourceQuote ?? null,
      status: "active",
    })
    .select("*")
    .single();

  const newRow = assertFashionRow(
    "upsertFashionFact",
    inserted.data as FashionFactRow<T> | null,
    inserted.error,
  );

  if (active.data?.id) {
    await db
      .from("fashion_facts")
      .update({
        status: "superseded",
        superseded_by: newRow.id,
      })
      .eq("id", active.data.id)
      .eq("user_id", params.userId);
  }

  return newRow;
}

export async function listActiveFashionFacts(params: {
  userId: string;
  personId: string;
  factType?: FashionFactType;
}): Promise<FashionFactRow[]> {
  const db = fashionMemoryDb();
  let q = db
    .from("fashion_facts")
    .select("*")
    .eq("user_id", params.userId)
    .eq("person_id", params.personId)
    .eq("status", "active");
  if (params.factType) q = q.eq("fact_type", params.factType);
  const rows = await q.order("created_at", { ascending: false });
  if (rows.error) throw new Error(rows.error.message);
  return (rows.data ?? []) as FashionFactRow[];
}

export function fashionFactValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function findActiveFashionFact(params: {
  userId: string;
  personId: string;
  factType: FashionFactType;
  garmentType?: string | null;
}): Promise<FashionFactRow | null> {
  const facts = await listActiveFashionFacts({
    userId: params.userId,
    personId: params.personId,
    factType: params.factType,
  });
  const garment = garmentKey(params.garmentType);
  return (
    facts.find((f) => garmentKey(f.garment_type) === garment) ?? null
  );
}

/**
 * Hard-delete measurement facts for a person (privacy — body data).
 * Used by person try-on / hard-delete purge. Superseded rows included.
 */
export async function purgePersonMeasurementFacts(params: {
  userId: string;
  personId: string;
}): Promise<number> {
  const db = fashionMemoryDb();
  const result = await db
    .from("fashion_facts")
    .delete()
    .eq("user_id", params.userId)
    .eq("person_id", params.personId)
    .eq("fact_type", "measurement");
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

/** Count only — never return measurement values to admin/debug UIs. */
export async function countActiveMeasurementFacts(params: {
  userId: string;
  personId: string;
}): Promise<number> {
  const facts = await listActiveFashionFacts({
    userId: params.userId,
    personId: params.personId,
    factType: "measurement",
  });
  return facts.length;
}
