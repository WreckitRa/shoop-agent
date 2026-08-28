import { randomUUID } from "node:crypto";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import {
  createPerson,
  ensureSelfPerson,
  listPeopleForUser,
} from "../people";
import { upsertFashionFact } from "../facts";
import { logRequestEvent, upsertStyleSignal } from "../signals";
import { fashionMemoryDb } from "../db";
import {
  FashionLocalStore,
  emptyGuestFashionMemorySnapshot,
} from "../local/store";
import type {
  FashionFactType,
  PersonRow,
  StyleSignalSource,
  StyleSignalStatus,
  StyleSignalType,
} from "../types";
import type { Session } from "./dump";
import { parsePersonLabel, personKey } from "./names";
import type { MemoryCase, StoreKind } from "./types";

export async function wipeSupabaseUser(userId: string): Promise<void> {
  const db = fashionMemoryDb();
  const tables = [
    "fashion_facts",
    "style_signals",
    "request_events",
    "extraction_runs",
    "people",
  ] as const;
  for (const table of tables) {
    const { error } = await db.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`${table} wipe: ${error.message}`);
  }
}

export function newScratchUserId(kind: StoreKind): string {
  const id = randomUUID();
  return kind === "local" ? `guest-${id}` : id;
}

export async function openSession(kind: StoreKind): Promise<Session> {
  if (kind === "supabase" && !isSupabaseAuthConfigured()) {
    throw new Error("supabase is not configured");
  }
  const userId = newScratchUserId(kind);
  if (kind === "local") {
    const local = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    local.ensureSelfPerson(userId);
    return { kind, userId, local };
  }
  await ensureSelfPerson(userId);
  return { kind, userId };
}

export async function closeSession(session: Session): Promise<void> {
  if (session.kind === "supabase") {
    await wipeSupabaseUser(session.userId);
  }
}

async function peopleOf(session: Session): Promise<PersonRow[]> {
  if (session.kind === "local") {
    return session.local!.snapshot.people.filter(
      (p) => p.user_id === session.userId,
    );
  }
  return listPeopleForUser(session.userId);
}

export async function personByLabel(
  session: Session,
  label: string,
): Promise<PersonRow | null> {
  const people = await peopleOf(session);
  const parsed = parsePersonLabel(label);
  const want = personKey(parsed.relation, parsed.name);
  return (
    people.find((p) => personKey(p.relation, p.name) === want) ??
    people.find(
      (p) => p.relation.toLowerCase() === parsed.relation && !parsed.name,
    ) ??
    null
  );
}

async function ensurePerson(
  session: Session,
  relation: string,
  name?: string,
): Promise<PersonRow> {
  if (relation === "self") {
    if (session.kind === "local") {
      return session.local!.ensureSelfPerson(session.userId);
    }
    return ensureSelfPerson(session.userId);
  }
  const existing = await personByLabel(
    session,
    name ? `${relation} (${name})` : relation,
  );
  if (existing) return existing;
  if (session.kind === "local") {
    return session.local!.createPerson({
      userId: session.userId,
      relation,
      name: name ?? null,
    });
  }
  return createPerson({
    userId: session.userId,
    relation,
    name: name ?? null,
  });
}

export async function seedSession(
  session: Session,
  cse: MemoryCase,
): Promise<void> {
  await ensurePerson(session, "self");
  for (const p of cse.seed.people) {
    await ensurePerson(session, p.relation, p.name);
  }

  for (const f of cse.seed.facts ?? []) {
    const person = await personByLabel(session, f.person);
    if (!person) throw new Error(`seed person missing: ${f.person}`);
    if (session.kind === "local") {
      session.local!.upsertFashionFact({
        userId: session.userId,
        personId: person.id,
        factType: f.fact_type as FashionFactType,
        garmentType: f.garment_type,
        value: f.value as never,
        sourceQuote: "eval-memory:seed",
      });
    } else {
      await upsertFashionFact({
        userId: session.userId,
        personId: person.id,
        factType: f.fact_type as FashionFactType,
        garmentType: f.garment_type,
        value: f.value as never,
        sourceQuote: "eval-memory:seed",
      });
    }
  }

  for (const s of cse.seed.signals ?? []) {
    const person = await personByLabel(session, s.person);
    if (!person) throw new Error(`seed person missing: ${s.person}`);
    const args = {
      userId: session.userId,
      personId: person.id,
      context: s.context,
      signalType: s.signal_type as StyleSignalType,
      value: s.value,
      polarity: s.polarity,
      source: s.source as StyleSignalSource,
      status: (s.status as StyleSignalStatus | undefined) ??
        (s.source === "stated" ? "active" : "candidate"),
      confidence: s.confidence,
      sourceQuote: "eval-memory:seed",
      incrementEvidence: false as const,
    };
    if (session.kind === "local") {
      session.local!.upsertStyleSignal(args);
    } else {
      await upsertStyleSignal(args);
    }
  }
}

export async function seedRequestEvents(
  session: Session,
  cse: MemoryCase,
  conversations: Map<string, string>,
): Promise<void> {
  for (const ev of cse.seed.request_events ?? []) {
    const person = await personByLabel(session, ev.person);
    if (!person) throw new Error(`seed person missing: ${ev.person}`);
    const conversationId = conversations.get(ev.conversation);
    if (!conversationId) {
      throw new Error(`seed conversation missing: ${ev.conversation}`);
    }
    if (session.kind === "local") {
      session.local!.logRequestEvent({
        userId: session.userId,
        personId: person.id,
        conversationId,
        attributes: ev.attributes,
      });
    } else {
      await logRequestEvent({
        userId: session.userId,
        personId: person.id,
        conversationId,
        attributes: ev.attributes,
      });
    }
  }
}
