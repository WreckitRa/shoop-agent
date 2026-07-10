import { ensureSelfPerson } from "./people";
import { upsertFashionFact } from "./facts";
import { upsertStyleSignal } from "./signals";
import { fashionMemoryDb } from "./db";
import type { GuestFashionMemorySnapshot } from "./local/store";
import type {
  ExtractionRunRow,
  FashionFactRow,
  PersonRow,
  RequestEventRow,
  StyleSignalRow,
} from "./types";

function sortByCreatedAt<
  T extends { created_at?: string; first_seen_at?: string },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      new Date(a.created_at ?? a.first_seen_at ?? 0).getTime() -
      new Date(b.created_at ?? b.first_seen_at ?? 0).getTime(),
  );
}

/**
 * Import guest localStorage fashion memory into Supabase on login.
 * Remaps local person ids to real auth user rows.
 */
export async function migrateGuestFashionMemoryToUser(params: {
  realUserId: string;
  snapshot: GuestFashionMemorySnapshot;
}): Promise<{ people: number; facts: number; signals: number; events: number }> {
  const { realUserId, snapshot } = params;
  if (!snapshot.people.length && !snapshot.request_events.length) {
    await ensureSelfPerson(realUserId);
    return { people: 0, facts: 0, signals: 0, events: 0 };
  }

  const personIdMap = new Map<string, string>();
  const self = await ensureSelfPerson(realUserId);

  for (const localSelf of snapshot.people.filter((p) => p.relation === "self")) {
    personIdMap.set(localSelf.id, self.id);
  }

  for (const person of sortByCreatedAt(
    snapshot.people.filter((p) => p.relation !== "self"),
  )) {
    const db = fashionMemoryDb();
    const inserted = await db
      .from("people")
      .insert({
        user_id: realUserId,
        relation: person.relation,
        name: person.name,
        birthday: person.birthday,
        notes: person.notes,
        created_at: person.created_at,
        updated_at: person.updated_at,
      })
      .select("*")
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(inserted.error?.message ?? "Failed to migrate person");
    }
    personIdMap.set(person.id, (inserted.data as PersonRow).id);
  }

  const mapPerson = (localPersonId: string): string => {
    const mapped = personIdMap.get(localPersonId);
    if (!mapped) throw new Error(`Missing person map for ${localPersonId}`);
    return mapped;
  };

  let facts = 0;
  for (const fact of sortByCreatedAt(snapshot.fashion_facts)) {
    if (fact.status !== "active") continue;
    await upsertFashionFact({
      userId: realUserId,
      personId: mapPerson(fact.person_id),
      factType: fact.fact_type,
      garmentType: fact.garment_type,
      value: fact.value as FashionFactRow["value"],
      sourceQuote: fact.source_quote,
    });
    facts += 1;
  }

  let signals = 0;
  for (const signal of sortByCreatedAt(snapshot.style_signals)) {
    if (signal.status === "superseded") continue;
    await upsertStyleSignal({
      userId: realUserId,
      personId: mapPerson(signal.person_id),
      context: signal.context,
      signalType: signal.signal_type,
      value: signal.value,
      polarity: signal.polarity,
      source: signal.source,
      confidence: signal.confidence,
      status: signal.status,
      sourceQuote: signal.source_quote,
      incrementEvidence: false,
    });
    signals += 1;
  }

  const db = fashionMemoryDb();
  let events = 0;
  for (const event of sortByCreatedAt(snapshot.request_events)) {
    const row = await db
      .from("request_events")
      .insert({
        user_id: realUserId,
        person_id: mapPerson(event.person_id),
        conversation_id: event.conversation_id,
        attributes: event.attributes,
        created_at: event.created_at,
      })
      .select("*")
      .single();
    if (row.error) throw new Error(row.error.message);
    events += 1;
    void (row.data as RequestEventRow);
  }

  for (const run of sortByCreatedAt(snapshot.extraction_runs)) {
    await db.from("extraction_runs").insert({
      user_id: realUserId,
      conversation_id: run.conversation_id,
      last_message_id: run.last_message_id,
      status: run.status,
      ops_applied: run.ops_applied,
      ambiguous_subjects: run.ambiguous_subjects,
      created_at: run.created_at,
      finished_at: run.finished_at,
    });
    void (run as ExtractionRunRow);
  }

  return {
    people: personIdMap.size,
    facts,
    signals,
    events,
  };
}
