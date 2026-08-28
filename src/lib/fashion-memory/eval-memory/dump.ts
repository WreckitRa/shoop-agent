import { fashionMemoryDb } from "../db";
import { FashionLocalStore } from "../local/store";
import { formatRecentPicksLine } from "../router/profile-context-format";
import {
  getDoneExtractionWatermark,
  getLatestDoneExtractionRun,
} from "../extraction-runs";
import type {
  FashionFactRow,
  PersonRow,
  RequestEventRow,
  StyleSignalRow,
} from "../types";
import { formatPersonKey, parsePersonLabel, personKey } from "./names";
import type { StoreDump, StoreKind } from "./types";

export type Session = {
  kind: StoreKind;
  userId: string;
  local?: FashionLocalStore;
};

function personLabel(people: PersonRow[], personId: string): string {
  const p = people.find((x) => x.id === personId);
  if (!p) return personId.slice(0, 8);
  return formatPersonKey(p.relation, p.name);
}

function dumpFromRows(params: {
  people: PersonRow[];
  facts: FashionFactRow[];
  signals: StyleSignalRow[];
  events: RequestEventRow[];
  ambiguous: number;
  watermark: string | null;
}): StoreDump {
  const { people } = params;
  const self = people.find((p) => p.relation === "self");
  const selfEvents = self
    ? params.events.filter((e) => e.person_id === self.id)
    : [];
  return {
    people: people.map((p) => ({
      id: p.id,
      relation: p.relation,
      name: p.name,
    })),
    facts: params.facts.map((f) => ({
      person_id: f.person_id,
      person: personLabel(people, f.person_id),
      fact_type: f.fact_type,
      garment_type: f.garment_type,
      value: f.value,
      status: f.status,
    })),
    signals: params.signals.map((s) => ({
      person_id: s.person_id,
      person: personLabel(people, s.person_id),
      signal_type: s.signal_type,
      value: (s.value_canonical ?? s.value).trim(),
      polarity: s.polarity,
      source: s.source,
      status: s.status,
      context: s.context,
      confidence: s.confidence,
    })),
    request_events: params.events.map((e) => ({
      person_id: e.person_id,
      person: personLabel(people, e.person_id),
      conversation_id: e.conversation_id,
      attributes: e.attributes,
    })),
    ambiguous_subjects: params.ambiguous,
    next_router_asks: [],
    recent_picks_line: formatRecentPicksLine(selfEvents),
    watermark: params.watermark,
  };
}

async function dumpSupabase(userId: string): Promise<StoreDump> {
  const db = fashionMemoryDb();
  const [people, facts, signals, events, latest] = await Promise.all([
    db.from("people").select("*").eq("user_id", userId),
    db.from("fashion_facts").select("*").eq("user_id", userId),
    db.from("style_signals").select("*").eq("user_id", userId),
    db.from("request_events").select("*").eq("user_id", userId),
    db
      .from("extraction_runs")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (people.error) throw new Error(people.error.message);
  if (facts.error) throw new Error(facts.error.message);
  if (signals.error) throw new Error(signals.error.message);
  if (events.error) throw new Error(events.error.message);

  const peopleRows = (people.data ?? []) as PersonRow[];
  const latestRun = latest.data as
    | { ambiguous_subjects?: unknown[] | null; conversation_id?: string }
    | null;
  const wm = latestRun?.conversation_id
    ? await getDoneExtractionWatermark({
        userId,
        conversationId: latestRun.conversation_id,
      })
    : null;

  return dumpFromRows({
    people: peopleRows,
    facts: (facts.data ?? []) as FashionFactRow[],
    signals: (signals.data ?? []) as StyleSignalRow[],
    events: (events.data ?? []) as RequestEventRow[],
    ambiguous: Array.isArray(latestRun?.ambiguous_subjects)
      ? latestRun.ambiguous_subjects.length
      : 0,
    watermark: wm,
  });
}

function dumpLocal(session: Session): StoreDump {
  const store = session.local!;
  const snap = store.snapshot;
  const people = snap.people.filter((p) => p.user_id === session.userId);
  const latest = snap.extraction_runs
    .filter((r) => r.user_id === session.userId && r.status === "done")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return dumpFromRows({
    people,
    facts: snap.fashion_facts.filter((f) => f.user_id === session.userId),
    signals: snap.style_signals.filter((s) => s.user_id === session.userId),
    events: snap.request_events.filter((e) => e.user_id === session.userId),
    ambiguous: latest?.ambiguous_subjects?.length ?? 0,
    watermark: latest?.last_message_id ?? null,
  });
}

export async function dumpSession(session: Session): Promise<StoreDump> {
  if (session.kind === "local") return dumpLocal(session);
  return dumpSupabase(session.userId);
}

export async function dumpAmbiguousForConversation(
  session: Session,
  conversationId: string,
): Promise<number> {
  if (session.kind === "local") {
    const latest = session.local!.getLatestExtractionRun({
      userId: session.userId,
      conversationId,
    });
    return latest?.status === "done"
      ? (latest.ambiguous_subjects?.length ?? 0)
      : 0;
  }
  const run = await getLatestDoneExtractionRun({
    userId: session.userId,
    conversationId,
  });
  return run?.ambiguous_subjects?.length ?? 0;
}

export function resolveSessionPerson(
  people: PersonRow[],
  label: string,
): PersonRow | null {
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
